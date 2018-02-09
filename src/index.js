var clientside_module_manager = { // a singleton object
    modules_root : (typeof window.node_modules_root == "undefined")? location.origin + "/node_modules/" : window.node_modules_root, // define root; default is /node_modules/

    /*
        loading functionality
            - top level functions preserve content scope (e.g., when loading the javascript we dont pollute the global scope and instead all of the module.exports content is resolved)
            - basic[] functions do not nessesarily preserve content scope
            - helper functions support top level functions
    */
    loader_functions : {
        js : function(path){ // this is the only special function since we need to scope the contents properly
            var promise_frame_loaded = this.helpers.promise_to_create_frame();
            var promise_exports = promise_frame_loaded
                .then((frame)=>{
                    //console.log("frame loaded. document : ")
                    /*
                        NOTE (important) : the contentWindow properties defined will be availible in the loaded modules BUT NOT availible to the clientside-module-manager;
                                            clientside module manager is only accessible by the contentWindow.require  function that is passed;
                                            the clientside-module-manager (this object) will have the same global window as the main file at ALL times.
                    */
                    frame.contentWindow.module = {};
                    frame.contentWindow.console = console; // pass the console functionality

                    var relative_path_root = path.substring(0, path.lastIndexOf("/")) + "/"; // path to module without the filename
                    frame.contentWindow.require = function(request, options){ // wrap  ensure relative path root is defined for all requests made from modules
                        if(typeof options == "undefined"){options={relative_path_root:relative_path_root}}else{options.relative_path_root=relative_path_root;} // define options.relative_path_root without overwriting existing options; yes, overwrite relative_path_root though
                        return clientside_module_manager.require(request, options)
                    };

                    var frame_document = frame.contentWindow.document;
                    return this.basic.promise_to_load_script_into_document(path, frame_document)
                })
                .then((frame_document)=>{
                    var frame_window = frame_document.defaultView;
                    //console.log(frame_window);
                    //console.log(frame_window.module)
                    return(frame_window.module.exports);
                })

            var promise_to_remove_frame = Promise.all([promise_frame_loaded, promise_exports])
                .then(([frame, __])=>{
                    frame.parentNode.removeChild(frame);
                })

            var promise_exports_and_removal = Promise.all([promise_exports, promise_frame_loaded])
                .then(([exports, __])=>{
                    //console.log("exports:");
                    //console.log(exports);
                    return exports;
                })

           var resolution_promise = promise_exports_and_removal; // rename the promise to be explicit that this promise we will resolve

            return resolution_promise;
        },
        json : function(path){ return this.basic.promise_to_retreive_json(path) },
        html : function(path){ return this.basic.promise_to_get_html_from_file(path) },
        css : function(path){ return this.basic.promise_to_load_css_into_window(path) },
        basic : {
            promise_to_load_script_into_document : function(script_src, target_document){
                if(typeof target_document == "undefined") target_document = window.document; // if no document is specified, assume its the window's document
                return new Promise((resolve, reject)=>{
                    var script = document.createElement('script');
                    script.setAttribute("src", script_src);
                    script.onload = function(){
                        resolve(target_document);
                    };
                    target_document.getElementsByTagName('head')[0].appendChild(script);
                })
            },
            promise_to_retreive_json : function(json_source){
                return new Promise((resolve, reject)=>{
                    var xhr = new XMLHttpRequest();
                    xhr.overrideMimeType("application/json");
                    xhr.open("GET", json_source, true);
                    xhr.onload = function(){
                        resolve(JSON.parse(this.responseText));
                    };
                    xhr.send();
                })
            },
            promise_to_load_css_into_window : function(styles_href, target_document){
                if(typeof target_document == "undefined") target_document = window.document; // if no document is specified, assume its the window's document
                // <link rel="stylesheet" type="text/css" href="/_global/CSS/spinners.css">
                return new Promise((resolve, reject)=>{
                    var styles = document.createElement('link');
                    styles.type = "text/css";
                    styles.rel = 'stylesheet';
                    styles.href = styles_href;
                    styles.onload = function(){
                        resolve(target_document);
                    };
                    target_document.getElementsByTagName('head')[0].appendChild(styles);
                })
            },
            promise_to_get_html_from_file : function(destination_path){
                return new Promise((resolve, reject)=>{
                    var xhr = new XMLHttpRequest();
                    xhr.open("POST", destination_path, true);
                    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
                    xhr.onload = function(){
                        resolve(this.responseText)
                    };
                    xhr.send();
                })
            },
        },
        helpers : {
            promise_to_create_frame : function(){
                return new Promise((resolve, reject)=>{
                    //console.log("building promise");
                    var frame = document.createElement('iframe');
                    frame.onload = function(){resolve(frame)};
                    frame.style.display = "none"; // dont display the iframe
                    document.querySelector("html").appendChild(frame);
                })
            }
        },
    },

    /*
        extract request details
            - is it an npm module reference? if so then we need to generate the path to the main file
            - what filetype should we load?
    */
    promise_request_details : function(request, relative_path_root){
        var absolute_path = request.indexOf("/") > -1;
        var extension = request.split('.').pop();
        var exists_file_extension = extension != request; // if theres no period it'll return the full string

        if(!absolute_path && !exists_file_extension){ // if not an absolute path and no extension, assume its a node_module.
            var package_json_path = this.modules_root + request + "/package.json";
            return this.loader_functions.basic.promise_to_retreive_json(package_json_path)
                .then((package_json)=>{
                    var main = package_json.main;
                    var path = this.modules_root + request + "/" + main; // generate path based on the "main" data in the package json
                    return {type : "js", path : path}
                })
        } else if(["js", "json", "css", "html"].indexOf(extension) > -1){ // if its an acceptable extension and not defining a module
            var path = request; // since its not defining a module, the request has path information
            if(!absolute_path) path = relative_path_root + path; // if not an absolute path, use the relative_path_root to generate an absolute path
            return Promise.resolve({type : extension, path : path})
        } else {
            return Promise.reject("invalid request");
        }
    },

    /*
        options functionality
    */
    options_functionality : {
        append_functions_to_promise : function(resolution_promise, options){ //  options.functions functionality
            if(typeof options != "undefined" && typeof options.functions != "undefined"){
                var blacklist = ["then", "catch", "spread"];
                var function_keys = Object.keys(options.functions);
                for(var i = 0; i < function_keys.length; i++){
                    var function_key = function_keys[i];
                    if(blacklist.indexOf(function_key) > -1) {
                        console.warn("functions in require(__, {functions : {} }) included a blacklisted function name : `"+key+"`. skipping this function.")
                    } else {
                        var requested_function = options.functions[function_key];
                        resolution_promise[function_key] = requested_function; // append the function to the promise
                    }
                }
            }
            return resolution_promise;
        },
        extract_relative_path_root : function(options){
            if(typeof options != "undefined" && typeof options.relative_path_root != "undefined"){ // if rel_path is defined,  use it; occurs when we are in modules
                var relative_path_root = options.relative_path_root;
            } else { // if rel_path not defined, we are not loading from another module; retreive the directory (strip filename + query) from the main window.location.href
                var relative_path_root = window.location.href.substring(0, window.location.href.lastIndexOf("/")) + "/";
            }
            return relative_path_root;
        },
    },


    /*
        the bread and butter
            - parse the request, load the file, resolve the content
            - ensures that promise is only queued once with caching
    */
    _cache : {},
    promise_to_require : function(module_or_path, options){// load script into iframe to create closed namespace
                                                  // TODO : handle require() requests inside of the module with caching included
        if(typeof this._cache[module_or_path] == "undefined"){ // if not in cache, build into cache
            var relative_path_root = this.options_functionality.extract_relative_path_root(options);
            var promise_content = this.promise_request_details(module_or_path, relative_path_root) // returns [type, path]; type from [npm, js, json, css, html]; path is full path to file
                .then((request)=>{
                    return this.loader_functions[request.type](request.path, options); // loader_function[type](path)
                })
            this._cache[module_or_path] = promise_content; // cache the promise (and consequently the result)
        }

        var promise_content = this._cache[module_or_path];
        var promise_content = this.options_functionality.append_functions_to_promise(promise_content, options); // options.functions functionality
        return promise_content;
    },
    require : function(request, options){
        return clientside_module_manager.promise_to_require(request, options);
    }, // convinience handler
}

var require = clientside_module_manager.require;
