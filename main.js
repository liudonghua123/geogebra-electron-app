const fs = require('fs');
const fetch = require('node-fetch');

// Parse command line options and collect those that will be important immediately.
parseCommandLineOptions();

// Logging helper commands.
function printError(msg, e) {
    if (!muteLogging) {
        console.log("\x1b[31m%s: \x1b[1m%s\x1b[0m", msg, e);
    } else {
        console.log("\x1b[31m%s\x1b[0m", msg);
    }
}

function printDebug(msg) {
    if (!muteLogging) {
        console.log(msg);
    }
}

function printInfo(msg) {
    console.log("\x1b[1m%s\x1b[0m", msg);
}

// Communication related code from GeoGebra to Electron.
ipc = require('electron').ipcMain;

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;

// ipc calls from GeoGebra.
ipc.on('log', function (event, message) {
    event.returnValue = true;
    if (!muteLogging) {
        // Print fancy log message
        console.log("\x1b[36mGeoGebra: \x1b[1m%s\x1b[0m", message);
    }

    if (logWatch && message.search(logExit) > 0) {
        logWatch = false;
        printDebug("Exiting due to matching log text");
        process.exit(0);
    }

    if (getVersion) {
        if (geoGebraVersion != "undef") {
            process.exit(0);
        }
        if ((message.search("INFO") > 0) && ((pos = message.search("GeoGebra")) > 0)) {
            geoGebraVersion = message.substring(pos);
        }
    }
});

ipc.on('openUrl', function (event, url) {
    if (url.startsWith("https://")) {
        const shell = require('electron').shell;
        shell.openExternal(url);
    }
});

const examState = {};

ipc.on('exam', function(event, on) {
    const { powerSaveBlocker } = require('electron');
    if (on) {
        trySpawn("disablekeys.exe", [], (proc) => {
            examState.disablekeys = proc
        });
        win.setKiosk(true); // disables all system shortcuts on Mac and ESC on Windows
        examState.psBlocker = powerSaveBlocker.start('prevent-display-sleep');
        return;
    } else {
        win.setKiosk(false);

        if (examState.disablekeys) {
            examState.disablekeys.kill();
        }
        if (examState.psBlocker != undefined) {
            powerSaveBlocker.stop(examState.psBlocker);
            printDebug("Power saving restored");
        }
    }
    printDebug("Exam mode: " + on);
});

ipc.on('unsaved', function(event, data) {
    win.unsaved = JSON.parse(data);
});

const {app, BrowserWindow, Menu} = require('electron');
const Config = require('electron-store');
const path = require('path');
const ggbConfig = require('./ggb-config.js');
// For some reason, when using Ermine to create an all-in-one bundle,
// this line results in a "SyntaxError: Unexpected token export", so
// we load 'windows-shortcuts' later only, when explicitly needed.
// const ws = require('windows-shortcuts');

function createWindow(appArgs) {

    // Create the browser window...
    var pref = {
        show: false,
        width: 1024,
        height: 768,
        title: "GeoGebra",
        webPreferences: {
            nodeIntegration: false,
            preload: __dirname + '/preload.js',
            contextIsolation: true // with this setting we need nativeWindowOpen:true (default)
        }
    };
    const config = new Config();
    Object.assign(pref, config.get('winBounds'))

    // ...and load the *.html of the app.
    // See the function onReady() later that prepares the variable appArgs.
    var startUrl = 'app://html/classic.html?';
    var perspective = appArgs['perspective'] ? appArgs['perspective'] : ggbConfig.appName;
    if (perspective && perspective.match(/^graphing|geometry|notes|cas|suite$/)) {
        startUrl = `app://html/${perspective.replace('notes','notes-mebis')}.html?`;
        pref.icon = __dirname + "/html/" + perspective.replace("suite", "ggb") + ".ico";
    } else if (perspective) {
        startUrl += "?perspective=" + appArgs['perspective'];
    }
    if (appArgs['prerelease']) {
        startUrl += "&prerelease=" + appArgs['prerelease'];
    }
    if (appArgs['debug']) {
        startUrl += "&debug=" + appArgs['debug'];
    }
    if (appArgs['filename']) {
        startUrl += "&filename=" + appArgs['filename'];
    }
    if (appArgs['ggbbase64']) {
        startUrl += "&ggbbase64=" + appArgs['ggbbase64'];
    }
    // language setting (overridden by cookie on subsequent runs)
    // app.getLocale() is crossplatform, process.env.LANG works for locales not supported by chrome, e.g. de_AT.UTF_8
    const lang = process.env.LANG ? process.env.LANG.split(/\./)[0] : app.getLocale();
    startUrl += "&lang=" + lang;

    win = new BrowserWindow(pref);
    win.setMenuBarVisibility(false);
    win.setAutoHideMenuBar(true);
    win.loadURL(startUrl);

    const appName = ggbConfig.appName || "classic";

    // startup ping (tracking usage statistics in Firebase)
    var streamIDs = {
            "graphing": "G-Q0XVP4Q2QS",
            "cas": "G-WBR8KV3VDN",
            "classic": "G-P0Q2098X7G",
            "geometry": "G-6NZX4TXBMJ",
            "suite": "G-YTSRE0SSN4",
    };

    if (streamIDs[appName]) {
        printDebug("fetching", "https://www.google-analytics.com/g/collect?v=2&tid=" + streamIDs[appName] + "&cid=$uid&uip=$uip&en=pageview&ep.origin=firebase");
        fetch("https://www.google-analytics.com/g/collect?v=2&tid=" + streamIDs[appName] + "&cid=$uid&uip=$uip&en=pageview&ep.origin=firebase", 
            {method: "POST", headers: {'User-Agent': 'GeoGebra Apps'}});
    }

    // Open the DevTools.
    // win.webContents.openDevTools()
    win.webContents.on('did-finish-load', () => {
        pref.show = true;
        win.show();
    });
    win.webContents.on('did-create-window', (childWindow) => {
       // hide menu in login window
       childWindow.setMenuBarVisibility(false);
       childWindow.setAutoHideMenuBar(true);
    })
    // Emitted when the window is closed.
    win.on('closed', () => {
        printDebug("Window is closed");
        if (getVersion) {
            version6 = geoGebraVersion.match(/GeoGebra (5\.\d+\.\d+\.\d)/); // async
            version6 = (version6[0]).replace(" 5", " 6");
            printInfo(version6); // Maybe we want to print more information later. TODO
        }
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        win = null
    })
    win.unsaved = null;
    win.on('close', async (e) => {
        if (!win.unsaved || !win.unsaved[0]) {
            config.set('winBounds', win.getBounds());
            return;
        }
        e.preventDefault();
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        const {dialog} = require('electron');
        const dialogOptions = {
                message: win.unsaved[0],
                buttons: win.unsaved.slice(1),
                title: 'GeoGebra'
             };
        const option = (await dialog.showMessageBox(win, dialogOptions)).response;
        if (option == 0) {
           win.loadURL("javascript:ggbApplet.checkSaved()");
        }
        if (option == 1) {
            win.unsaved = false;
            setTimeout(() => {win.close()}, 100);
        }
    });

}

function trySpawn(execRelative, params, callback) {
    var exec = process.execPath + "/../" + execRelative;
    callback = callback || function () {
    };
    var spawn2 = require("child_process");
    fs.access(exec, (err) => {
        err ? printError("Error on trySpawn", err) : callback(spawn2.spawn(exec, params))
    });
}

function getWinLocaleSync() {
    try {
        const crossSpawn = require('child_process');
        const lcid = require('lcid');
        const stdout = crossSpawn.spawnSync('wmic', ['os', 'get', 'locale'], {"encoding": "utf-8"}).stdout;
        const lcidCode = parseInt(stdout.replace('Locale', ''), 16);
        return lcid.from(lcidCode);
    } catch (e) {
        printError("Error on getWinLocaleSync", e);
    }
    return "en_US";
}

function getAppleLocaleSync() {
    try {
        const crossSpawn = require('child_process');
        return crossSpawn.spawnSync('defaults', ['read', '-g', 'AppleLocale']).stdout;
    } catch (e) {
        printError("Error on getAppleLocaleSync", e);
    }
    return "en_US";
}

function createShortcuts(locations) {
    var exe = process.execPath.split("\\").reverse()[0];
    let icons = locations.size;
    for (var k in locations) {
        var basePath = false;
        if (locations[k] == "Desktop") {
            basePath = p`${'userDesktop'}`;
        }
        if (locations[k] == "StartMenu") {
            basePath = p`${'appData'}/Microsoft/Windows/Start Menu/Programs/GeoGebra`;
            ensureDirSync(basePath);
        }
        if (basePath) {
            const loc = getWinLocaleSync() || "en_US";
            const dict = ggbConfig.localization.appName;
            const englishName = dict["en_US"] || "GeoGebra";
            const localizedName = dict[loc] || dict[loc.substr(0, 2)] || englishName;

            const lnkPath = basePath + "/" + localizedName + ".lnk";

            const ws = require('windows-shortcuts');
            ws.create(lnkPath, {
                    // Does this really work? FIXME I guess the target is not correctly set!
                    target: process.execPath + "/../../Update.exe",
                    icon: process.execPath,
                    args: `--processStart="${exe}"`
                },
                (err) => {
                    if (err) {
                        printError(`Could not create icon ${lnkPath}: ${err}`);
                    } else {
                        printDebug(`Finished creating icon ${lnkPath}`);
                    }
                    icons--;
                    if (icons < 1) {
                       process.exit(0);
                    }
                });
        }
    }
}

function ensureDirSync (dirpath) {
    try {
        return fs.mkdirSync(dirpath)
    } catch (err) {
        if (err.code !== 'EEXIST') {
            printError(err);
        }
    }
}

const environmentVariableAliases = {
    'HOME': 'home',
    'USERPROFILE': 'home',
    'APPDATA': 'appData',
    'TEMP': 'temp',
    'TMPDIR': 'temp'
};

function getPath(key) {

    let aliasKey = null;
    if (environmentVariableAliases[key]) {
        aliasKey = environmentVariableAliases[key];
    }

    let result = null;

    if (app) {
        try {
            result = app.getPath(aliasKey || key);
        } catch (e) {
            printError("Failed to get path for key", (aliasKey || key) + " may be expected");
            // NB: We'd like to log this but this method gets called too early:
            // logger.debug(`Failed to get path for key, this may be expected: ${aliasKey || key}`);
            // The above should work, but it has not yet been tested. TODO
        }
    }

    result = result || process.env[key];
    if (!result) {
        // NB: Try to fix up the most commonly used environment variables
        if (key.toLowerCase() === 'appdata' && process.env.USERPROFILE) {
            result = path.join(process.env.USERPROFILE, 'AppData', 'Roaming');
        }

        if (key.toLowerCase() === 'localappdata' && process.env.USERPROFILE) {
            result = path.join(process.env.USERPROFILE, 'AppData', 'Local');
        }
    }

    return result;
}

function p(strings, ...values) {
    let newVals = values.map((x) => getPath(x) || x);
    let newPath = String.raw(strings, ...newVals);
    let parts = newPath.split(/[\\\/]/).map((x) => x || '/');

    // Handle Windows edge case: If the execution host is cmd.exe, path.resolve() will not understand
    // what `C:` is (it needs to be `C:\`).
    if (process.platform === 'win32' && /:$/.test(parts[0])) parts[0] += '\\';

    try {
        return path.resolve(...parts);
    } catch (e) {
        return path.join(...parts);
    }
}

function updateShortcuts() {
    let locations = [];
    printDebug("Shortcuts update started.");
    var dirs = [p`${'appData'}/Microsoft/Windows/Start Menu/Programs/Startup`,
        p`${'appData'}/Microsoft/Windows/Start Menu/Programs/GeoGebra`,
        p`${'appData'}/Microsoft/Windows/Start Menu/Programs/GeoGebraFake`,
        p`${'userDesktop'}`];

    function updateIcon(filename, description, callback) {
        var currentFolder = process.execPath.replace(/\\[^\\]*$/, "");
        var appFolder = process.execPath.replace(/\\[^\\]*\\[^\\]*$/, "");
        var exe = process.execPath.split("\\").reverse()[0];
        var target = description.expanded.target;
        var updater = appFolder + "\\Update.exe";
        if (target === process.execPath || target === updater) {
            printDebug("Updating... filename=" + filename + ", description=" + description);
            const ws = require('windows-shortcuts');
            ws.edit(filename, {
                "target": updater, "workingDir": currentFolder, "icon": process.execPath,
                "args": `--processStart="${process.execPath}"`
            }, callback);
        } else {
            callback();
        }
    }

    function checkdir(i) {
        if (!dirs[i]) {
            process.exit(0);
            return; // exit may not be atomic
        }
        fs.readdir(dirs[i], function (err, files) {
            function checkFile(j) {
                f = files && files[j];
                if (f && f.match(/.lnk$/)) {
                    const ws = require('windows-shortcuts');
                    ws.query(dirs[i] + "/" + f, (errF, description) => {
                        updateIcon(dirs[i] + "/" + f, description, () => checkFile(j + 1));
                    });
                } else if (files && files[j + 1]) {
                    checkFile(j + 1);
                } else {
                    checkdir(i + 1);
                }
                return true;
            }

            checkFile(0);
        });
    }

    checkdir(0);
}

// On Raspberry Pi 3 the GPU emulation is too slow, so we disallow using GPU completely:
// if (!(process.arch === 'arm')) {
// This code has been moved into the startup script on Raspberry Pi to allow
// detection of Raspberry Pi version (because version 4 already supports 3D well enough).
if (forceGpu) {
    printDebug("Ignoring GPU blacklist to enable 3D");
    app.commandLine.appendSwitch("ignore-gpu-blacklist");
}

if (process.platform === 'darwin') {
    const {systemPreferences} = require('electron');
    systemPreferences.setUserDefault('NSDisabledDictationMenuItem', 'boolean', true);
    systemPreferences.setUserDefault('NSDisabledCharacterPaletteMenuItem', 'boolean', true);
}

function associateExeForFile(handlerName, handlerDescription, iconPath, exePath, extensionName) {
    // Taken from windows-registry.utils (HKEY_CLASSES_ROOT has been changed to HKEY_CURRENT_USER)
    try {
        var registry = require('windows-registry').registry;
        var windef = require('windows-registry').windef;

        var key = registry.openKeyFromPredefined(windef.HKEY.HKEY_CURRENT_USER, 'Software\\Classes', windef.KEY_ACCESS.KEY_ALL_ACCESS);

        registry.createKey(key, extensionName, windef.KEY_ACCESS.KEY_ALL_ACCESS);

        var appKey = registry.openKeyFromKeyObject(key, extensionName, windef.KEY_ACCESS.KEY_ALL_ACCESS);

        registry.setValueForKeyObject(appKey, '', windef.REG_VALUE_TYPE.REG_SZ, handlerName);
        appKey.close();

        registry.createKey(key, handlerName, windef.KEY_ACCESS.KEY_ALL_ACCESS);
        var handlerKey = registry.openKeyFromKeyObject(key, handlerName, windef.KEY_ACCESS.KEY_ALL_ACCESS);

        registry.setValueForKeyObject(handlerKey, '', windef.REG_VALUE_TYPE.REG_SZ, handlerDescription);
        registry.createKey(handlerKey, 'DefaultIcon', windef.KEY_ACCESS.KEY_ALL_ACCESS);

        var defaultIconKey = registry.openKeyFromKeyObject(handlerKey, 'DefaultIcon', windef.KEY_ACCESS.KEY_ALL_ACCESS);

        registry.setValueForKeyObject(defaultIconKey, '', windef.REG_VALUE_TYPE.REG_SZ, iconPath);

        registry.createKey(handlerKey, 'shell\\Open\\Command', windef.KEY_ACCESS.KEY_ALL_ACCESS);

        var commandKey = registry.openKeyFromKeyObject(handlerKey, 'shell\\Open\\Command', windef.KEY_ACCESS.KEY_ALL_ACCESS);
        registry.setValueForKeyObject(commandKey, '', windef.REG_VALUE_TYPE.REG_SZ, exePath);

        commandKey.close();
        handlerKey.close();
        key.close();
    } catch (e) {
        printError(e);
    }
}

let {protocol} = require('electron');

if (protocol.registerSchemesAsPrivileged) {
    // Electron 5+
    protocol.registerSchemesAsPrivileged([
      { scheme: 'app', privileges: { standard: true, secure: true } }
    ])
} else {
    // Electron <5
    protocol.registerStandardSchemes(['app'], { secure: true })
}

function validateUrl(url) {
    const domains = ["geogebra.org",
        "gstatic.com", "google-analytics.com", "googletagmanager.com", // analytics
        "google\\..*", "googleapis.com", "youtube.com", "googleusercontent.com", // google login
        "twitter.com", "twimg.com", // twitter login
        "facebook.com", "fbcdn.com", // FB login
        ".*.hotjar.com",
        "live.com", "windows.net", "msauth.net", "microsoftonline.com"]; // Windows / Office 365 login
    return url && url.match(new RegExp('^https:\\/\\/([^/]*\\.)?(' + domains.join('|') + ')(\\/.*)$'));
}

function enableFilter() {
    const { session } = require('electron')

    const filter = {
        urls: ['https://*/*', 'http://*/*']
    }

    session.defaultSession.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
        if (validateUrl(details.url)) {
            callback({requestHeaders: details.requestHeaders});
        } else {
            callback({cancel: true})
            console.log("Blocked request to " + details.url);
        }
    })
}

function localProtocol(request, callback) {
    const url = request.url.substr(5, request.url.length - 5);
    const bits = url.split("?");
    const urlPath = bits[0];
    const normalized = path.normalize(`${__dirname}/${urlPath}`);
    callback({path: normalized});
    printDebug("File " + normalized + " is to be loaded...");
}

function localError(error) {
    if (error) {
        printError("Error", "Failed to register protocol");
    } else {
        printDebug('Registered protocol succesfully');
    }
}

function onReady() {
    var nogui = false;
    const appArgs = {};
    process.argv.forEach(function (val, index, array) {
        if (val.match(/^--debug/)) {
            appArgs['debug'] = true;
        }
        if (loadFilename != "undef") {
            appArgs['filename'] = loadFilename;
        }
        if (ggbbase64 != "undef") {
            appArgs['ggbbase64'] = ggbbase64;
        }
        if (val.match(/^--app=/)) {
            appArgs['perspective'] = val.match(/^--app=(.*)/)[1];
        }
        if (val.match(/^--squirrel/) && !val.match(/^--squirrel-firstrun/)) {
            nogui = true;
            if (val.match(/^--squirrel-install/)) {
                createShortcuts(["Desktop", "StartMenu"]);
                printDebug("Icon creation");
                // File association
                var appFolder = process.execPath.replace(/\\[^\\]*\\[^\\]*$/, "");
                associateExeForFile('GeoGebra6FileAssociation', 'GeoGebra file',
                    process.execPath,
                    appFolder + '\\Update.exe --processStart=GeoGebra.exe --process-start-args="%0"', '.ggb');
                    // C:\Users\...\AppData\Local\GeoGebra_6\Update.exe --processStart=GeoGebra.exe --process-start-args="%0"
                printDebug("File association");

            } else if (val.match(/^--squirrel-update/)) {
                updateShortcuts();
                printDebug("Icon update");
                // THIS PIECE OF CODE IS UNTESTED. MAYBE WE NEED TO PUT IT TO A DIFFERENT PLACE...
                // File association
                var appFolder = process.execPath.replace(/\\[^\\]*\\[^\\]*$/, "");
                associateExeForFile('GeoGebra6FileAssociation', 'GeoGebra file',
                    process.execPath,
                    appFolder + '\\Update.exe --processStart=GeoGebra.exe --process-start-args="%0"', '.ggb');
                    // C:\Users\...\AppData\Local\GeoGebra_6\Update.exe --processStart=GeoGebra.exe --process-start-args="%0"
                printDebug("File association update");
                // END OF UNTESTED CODE

            } else {
                // --squirrel-obsolete, ...
                process.exit(0);
            }

            return;
        }
    });
    if (nogui) {
        printDebug("No GUI, exiting");
        return;
    }

    if (process.platform === 'darwin') {
        // Create our menu entries so that we can use MAC shortcuts
        var displayNames = {
            "graphing": "GeoGebra Graphing Calculator",
            "cas": "GeoGebra CAS Calculator",
            "classic": "GeoGebra Classic 6",
            "geometry": "GeoGebra Geometry",
            "notes": "Mebis Notes",
            "suite": "GeoGebra Calculator Suite",
        };
        app.setName(displayNames[ggbConfig.appName || "classic"]);
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            {
                label: 'GeoGebra', // ignored
                submenu: [
                    {role: 'quit'} // label set by app.getName
                ]
            },
            {
                label: 'Edit',
                submenu: [
                    {role: 'copy'},
                    {role: 'cut'},
                    {role: 'paste'},
                ]
            }]
        ));
    }
    app.setAppUserModelId("com.squirrel.geogebra.GeoGebra");
    protocol.unregisterProtocol('file');

    var successFile = protocol.registerFileProtocol('file', localProtocol);
    localError(!successFile);

    var successApp = protocol.registerFileProtocol('app', localProtocol);
    localError(!successApp);

    if (ggbConfig.appName != "notes") {
        enableFilter();
    }

    createWindow(appArgs);
    if (/^win/.test(process.platform)) {
        const subfolder = !ggbConfig.appName || (ggbConfig.appName == "classic") ? "" : (ggbConfig.appName + "/");
        trySpawn("../Update.exe", ["--update", "https://download.geogebra.org/installers/6.0/" + subfolder]);
    } else {
        printDebug("No autoupdate for " + process.platform);
    }

}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', onReady);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    app.quit()
});

app.on('activate', () => {
    printDebug("activate");
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow({})
    }
});

function parseCommandLineOptions() {
    muteLogging = true;
    getVersion = false;
    geoGebraVersion = "undef";
    loadFilename = "undef";
    ggbbase64 = "undef";
    forceWasm = false;
    logWatch = false;
    forceGpu = true;
    var options = process.argv.length;
    var lastDetectedOption = 0;

    process.argv.forEach(function (val, index, array) {
        if (index > 0) {
            if (val.match(/^--help/)) {
                printInfo("GeoGebra Classic 6");
                printInfo("Copyright © The GeoGebra Group, 2019\n")
                printInfo("See https://www.geogebra.org/license for license conditions.\n");
                printInfo("Usage: " + process.argv[0] + " [options] [FILE]\n");
                printInfo("Options:");
                printInfo("  --help               Print this help message");
                printInfo("  --v                  Print version");
                printInfo("  --silent=false       Enable logging");
                printInfo("  --forcegpu=<boolean> Disable/enable ignoring GPU blacklist to switch off 3D");
                printInfo("  --logexit=<text>     Exit when the log contains a given text (as regexp)");
                process.exit(0);
            } else if (val.match(/^--forcegpu=/)) {
                forceGpuInput = val.match(/^--forcegpu=(.*)/)[1];
                if (forceGpuInput == "false" || forceGpuInput == "off" || forceGpuInput == "0")
                    forceGpu = false;
                else
                    forceGpu = true;
                lastDetectedOption = index;
            } else if (val.match(/^--logexit=/)) {
                logWatch = true;
                logExit = val.match(/^--logexit=(.*)/)[1];
                lastDetectedOption = index;
            } else if (val.match(/^--silent=false/)) {
                muteLogging = false;
                lastDetectedOption = index;
            } else if (val.match(/^--v/)) {
                getVersion = true;
                lastDetectedOption = index;
            } else {
                if (index < options - 1) {
                    printError("Unrecognized option", val);
                }
            }
        }

        if (index == options - 1 && index > lastDetectedOption && !getVersion) {
            if (val.match(/^http/)) {
                printInfo("Attempt to open URL " + val);
                loadFilename = val;
            } else {
                const path = require('path');
                var appAbsPath = path.resolve(__dirname);
                var absfile = path.relative(appAbsPath, val);
                printInfo("Attempt to load file " + val);
                try {
                    try {
                        // attempt to load it via a relative path
                        ggbfile = fs.readFileSync(path.join(__dirname, absfile));
                        }
                    catch (e) {
                        // attempt to load it via an absolute path
                        ggbfile = fs.readFileSync(absfile);
                        }
                    ggbbase64 = Buffer.from(ggbfile).toString('base64');
                } catch (e) {
                    printError("Cannot open file", e);
                }
            }
        }
    })
}
