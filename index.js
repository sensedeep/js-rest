/*
    Rest.js - REST API supports

    export default new Rest('user', {
        check: { method: 'POST', uri: '/:controller/check', getMap: fn },
        login: { method: 'POST', uri: '/:controller/login', nomap: true },
        logout: { method: 'POST', uri: '/:controller/logout' },
    })

    APIs can have properties drawn from the js-net options. {
        base        Base url to use instead of the config.prefix
        clear       Clear prior feedback
        feedback    If false, never emit feedback. If true, emit feedback on success. Otherwise on errors.
        body        Post body data
        getMap      Invoke getMap function to map data before returning
        log         Set to true to trace the request and response
        method      HTTP method
        nomap       Do not use global map functions
        nologout    Don't logout if response is 401
        noparse     Don't json parse any JSON response
        progress    If true, show progress bar.
        putMap      Invoke putMap function to map data before saving
        raw         If true, return the full response object (see below). If false, return just the data.
        throw       If false, do not throw on errors
    }

    Callers then invoke as:

    import Model from '@/models/Model'
    Model.method(fields, options)

    Options:
        offset      Starting offset for first row
        limit       Limit of rows to return
        filter      Filter pattern to apply to results

    Additional Fetch options:
        clear       Clear prior feedback
        feedback    If false, never emit feedback. If true, emit feedback on success. Otherwise on errors.
        body        Post body data
        log         Set to true to trace the request and response
        method      HTTP method
        nologout    Don't logout if response is 401
        noparse     Don't json parse any JSON response
        noprefix    Don't prefix the URL. Use the window.location host address.
        progress    If true, show progress bar.
        raw         If true, return the full response object (see below). If false, return just the data.
        throw       If false, do not throw on errors
 */

import Net from 'js-net'
import Blend from 'js-blend'
import UUID from 'js-uuid'

/*
    Default routes
 */
const GroupRest = {
    create: { method: 'POST',  uri: '/:controller/create' },
    get:    { method: 'POST',  uri: '/:controller/get' },
    init:   { method: 'POST',  uri: '/:controller/init' },
    find:   { method: 'POST',  uri: '/:controller/find' },
    remove: { method: 'POST',  uri: '/:controller/remove', nomap: true },
    update: { method: 'POST',  uri: '/:controller/update' },
}

const SingletonRest = {
    create: { method: 'POST',  uri: '/:controller/create' },
    get:    { method: 'POST',  uri: '/:controller/get' },
    init:   { method: 'POST',  uri: '/:controller/init' },
    remove: { method: 'POST',  uri: '/:controller/remove', nomap: true },
    update: { method: 'POST',  uri: '/:controller/update' },
}

const Log = {
    info(...args) { console.log(...args) },
    error(...args) { console.log(...args) },
    exception(...args) { console.log(...args) },
    trace(...args) { console.log(...args) },
}

export default class Rest {
    /*
        WARNING: API keys become top-level instance properties
     */
    constructor(name, customApis = {}, modifiers = {group: true}) {
        this._net = new Net
        this._name = name.toLowerCase()
        this._model = toTitle(name)
        this._clientId = UUID()
        modifiers = this._modifiers = Object.assign({}, modifiers)
        modifiers.service = modifiers.service || ''
        this._service = modifiers.service || ''
        let base
        if (modifiers.base == 'singleton') {
            base = SingletonRest
        } else if (modifiers.base != 'none') {
            base = GroupRest
        }
        this._apis = Blend(Object.clone(base), customApis)

        for (let [action,api] of Object.entries(this._apis)) {
            if (typeof api == 'function') {
                this[action] = api
            } else {
                api.action = action
                this[action] = this.createAction(api, action)
            }
            if ((modifiers.getMap || modifiers.putMap) && !customApis[action]) {
                if (api.getMap === undefined && !api.nomap) {
                    api.getMap = modifiers.getMap
                }
                if (api.putMap === undefined && !api.nomap) {
                    api.putMap = modifiers.putMap
                }
            }
            if (!customApis[action] && api.context === undefined) {
                api.context = modifiers.context
            }
        }
    }

    static setConfig(callback, settings = {}) {
        Rest.settings = settings
        Rest.config = settings.config
        Rest.version = settings.version
        Rest.callback = callback
    }

    async invoke(reason, args) {
        let callback = Rest.callback
        if (callback) {
            args.controller = this._name
            args.model = this._model
            args.cache = this._modifiers.cache
            return await callback(reason, args)
        }
        return true
    }

    createAction(api, action) {
        return async function(fields, options = {}) {
            let {fetch, result} = await this.invoke('before', {action, fields, options})
            if (fetch) {
                let {args, uri} = await this.prepRemote(api, fields, options)
                let mark = new Date
                result = await this._net.fetch(uri, args)
                let elapsed = (new Date() - mark) / 1000
                if (result && api.getMap && !api.nomap) {
                    result = await api.getMap(result)
                }
                result = await this.invoke('after', {action, fields, options, result})
            }
            return result
        }
    }

    async prepRemote(api, fields, options) {
        /*
            Replace the route :NAME fields with param values
         */
        let action = api.action
        let name = this._name
        let service = this._service
        let serviceOverride = false
        let uri = api.uri.replace(/:\w*/g, function(match, lead, tail) {
            let field = match.slice(1)
            if (field == 'controller') {
                return name
            }
            if (field == 'service') {
                serviceOverride = true
                return service
            }
            return (fields && fields[controller]) ? fields[controller] : ''
        })
        if (!serviceOverride && this._service) {
            uri = this._service + uri
        }
        let args = Object.assign(Object.assign({}, api), options)
        let body = {fields: {}}
        if (fields) {
            for (let [field,value] of Object.entries(fields)) {
                body.fields[field] = value
            }
            if (body.fields && api.putMap && !api.nomap) {
                body.fields = await api.putMap(body.fields)
            }
        }
        if (api.context) {
            body.fields = api.context(body.fields)
        }
        if (app.state.app.logging) {
            options.logging = options.logging || app.state.app.logging
        }
        if (app.state.auth.assume) {
            options.assume = options.assume || app.state.auth.assume
        }
        options.clientId = this._clientId
        if (app.state.auth.apiToken) {
            body.token = app.state.auth.apiToken
        }
        body.options = Object.white(options, [
            'assume', 'clientId', 'create', 'offset', 'limit', 'filter', 'logging'
        ])
        body.version = Rest.version

        if (Object.keys(body).length > 0) {
            if (args.method != 'POST') {
                body._encoded_json_ = true;
            }
            body = JSON.stringify(body)
            if (args.method == 'POST') {
                args.body = body
            } else {
                let sep = (uri.indexOf('?') >= 0) ? '&' : '?'
                body = encodeURIComponent(body)
                uri = `${uri}${sep}${body}`
            }
        }
        args.headers = Object.assign(args.headers || {}, {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        })
        if (app.state.auth.tokens) {
            args.headers.Authorization = app.state.auth.tokens.idToken.jwtToken
        }
        args.base = Rest.config.api
        return {args, uri}
    }
}
