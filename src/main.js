// firebase serve -o $IP -p 8080 | browser-sync start --proxy 0.0.0.0:8080 --port 8081 --files "src/**/*"
// firebase serve -p 81 | browser-sync start --proxy 0.0.0.0:81 --port 8081 --files "src/**/*" | ngrok http --bind-tls "both" 81
// ============================= GLOBALS SETUP =================================
var db;
var ui;
var auth;
var user;
var types;
var updating;
var lastTime;
var canPredict;
var latestData;
var mediaDevice;
var selectedType;
var imageCapture;
var latestTrainFrame;
var btn = document.getElementById("btn");
var data = document.getElementById("data");
var video = document.getElementById("video");
var header = document.getElementById("header");
var welcome = document.getElementById("welcome");
var lastUpdated = document.getElementById("lastUpdated");
var selectedData = document.getElementById("selectedData");
var openposeFrame = document.getElementById("openposeCanvas");
var tensorflowFrame = document.getElementById("tensorCanvas");
var grabLatestFrame = document.getElementById("grabFrameCanvas");
var grabLatestFrameData = document.getElementById("grabFrameCanvasData");
// var angleNames = ["neck", "l_shoulder", "r_shoulder", "l_arm", "r_arm", "l_farm", "r_farm", "l_spine", "r_spine", "l_thigh", "r_thigh", "l_leg", "r_leg"]
// ============================ FIREBASE SETUP =================================
function initApp() {
    auth = firebase.auth();
    db = firebase.database();
    ui = new firebaseui.auth.AuthUI(auth);
    ui.start("#firebaseui-auth-container", {
        "signInFlow": "popup",
        "signInOptions": [firebase.auth.GoogleAuthProvider.PROVIDER_ID],
        "callbacks": {
            "uiShown": () => {
                console.log("Auto logging in...");
                document.getElementById("loader").style.display = "none";
                setTimeout(function () {
                    if (document.querySelector("#firebaseui-auth-container button")) document.querySelector("#firebaseui-auth-container button").click();
                }, 1000);
                return false;
            },
            "signInSuccess": (currentUser, credential, redirectUrl) => {
                var time = Date.now();
                user = currentUser.uid;
                console.log("Logging in as " + currentUser.displayName + " with id " + user + "...");
                ensureUserExists(user, currentUser.displayName, time, () => {
                    setupAppAndListeners(() => {
                        setInterval(updateStuff, 1000);
                        resize();
                        window.onresize = resize;
                        selectedData.onchange = function (e) {
                            selectedType = selectedData.options[selectedData.selectedIndex].value;
                            trainModel();
                        }
                        btn.addEventListener("click", () => {
                            updateUpdating(!updating);
                        });
                        mediaDevice = navigator.mediaDevices.getUserMedia({
                            video: true
                        });
                        trainModel(() => {
                            onGetUserMediaButtonClick();
                            document.getElementById("background").style.display = "none";
                            console.log("Setup app in " + (Date.now() - time) + "ms");
                        });
                    });
                });
                return false;
            }
        }
    });
}
// ========================= PASSIVE FIREBASE FUNCTIONS ========================
function setupAppAndListeners(cb) {
    db.ref("types").once("value", snap => {
        types = snap.val();
        document.querySelectorAll("#selectedData option").forEach(option => option.remove());
        for (var key of Object.keys(types)) {
            var option = document.createElement("option");
            option.text = types[key].toUpperCase();
            option.value = key;
            selectedData.appendChild(option);
        }
        selectedType = selectedData.options[selectedData.selectedIndex].value;
    });
    db.ref("users/" + user).once("value", snap => {
        var snapshot = snap.val();
        lastTime = snapshot.lastUpdated;
        latestData = snapshot.latestTensorData.datatype1;
        handleLatestData();
        welcome.innerHTML = "Welcome " + snapshot.name;
        openposeFrame.setAttribute("src", snapshot.latestOpenPoseFrame);
        tensorflowFrame.setAttribute("src", snapshot.latestTensorData.latestProcessedFrame);
        updateUpdating(false, () => {
            updateConfidences(0, 0, 0, () => {
                cb();
            });
        });
    });
    db.ref("users/" + user + "/latestOpenPoseFrame").on("value", (snap) => {
        openposeFrame.setAttribute("src", snap.val());
    });
    db.ref("users/" + user + "/lastUpdated").on("value", (snap) => {
        lastTime = snap.val();
    });
    db.ref("users/" + user + "/updating").on("value", (snap) => {
        updating = snap.val();
    });
    db.ref("users/" + user + "/dimensions").on("value", (snap) => {
        grabLatestFrameData.style.width = snap.val()[0] + "px";
        grabLatestFrameData.style.height = snap.val()[1] + "px";
        grabLatestFrame.style.width = (100 * (snap.val()[0] / snap.val()[1])) + "px";
        data.style.left = (100 * (snap.val()[0] / snap.val()[1]) + 20) + "px";
        data.style.right = (100 * ((1280 / snap.val()[1]) > (snap.val()[0] / snap.val()[1]) ? (1280 / snap.val()[1]) : (snap.val()[0] / snap.val()[1])) + 130) + "px";
    });
    db.ref("users/" + user + "/latestTensorData").on("value", snap => {
        var snapshot = snap.val();
        latestData = snapshot[selectedType];
        handleLatestData();
        latestTrainFrame = snapshot.latestProcessedFrame;
        tensorflowFrame.setAttribute("src", snapshot.latestProcessedFrame);
        runTensorflow(latestData, latestTrainFrame);
    });
    db.ref("users/" + user + "/latestConfidences").on("value", snap => {
        var data = snap.val();
        document.getElementById("warrior").ldBar.set(data.warriorii * 100);
        document.getElementById("tree").ldBar.set(data.tree * 100);
        document.getElementById("triangle").ldBar.set(data.triangle * 100);
    });
}

function ensureUserExists(user, name, time, cb) {
    db.ref("users/").child(user).once("value", snap => {
        if (snap.val() == null) {
            console.log("User " + name + " with id " + user + " did not exist before! Creating now...");
            db.ref("users/" + user).set({
                "key": user,
                "lastUpdated": time,
                "name": name,
                "updating": false,
                "dimensions": getReSize(),
                "latestOpenPoseFrame": "",
                "latestTensorData": {
                    "datatype1": 0,
                    "datatype2": 0,
                    "datatype3": 0,
                    "datatype4": 0,
                    "latestProcessedFrame": ""
                },
                "latestConfidences": {
                    "tree": 0,
                    "triangle": 0,
                    "warriorii": 0
                }
            }, cb);
        } else cb();
    });
}
// ============================= FIREBASE FUNCTIONS ============================
function updateUpdating(val, cb) {
    resize();
    console.log("Updating recording to " + (val ? "playing" : "stopped") + " @ " + (new Date()).toLocaleString() + "...");
    db.ref("users/" + user + "/updating").set(val, () => {
        if (cb) cb();
    });
}

function updateConfidences(warriorii, tree, triangle, cb) {
    console.log("Updating confidences; warriorii to " + warriorii + ", tree to " + tree + ", & triangle to " + triangle + " @ " + (new Date()).toLocaleString() + "...");
    db.ref("users/" + user + "/latestConfidences").set({
        "warriorii": warriorii,
        "tree": tree,
        "triangle": triangle
    }, () => {
        if (cb) cb();
    });
}

function updateDims(val, cb) {
    console.log("Updating window dimensions to " + val[0] + " × " + val[1]);
    db.ref("users/" + user + "/dimensions").set(val, () => {
        if (cb) cb();
    });
}

function updateLatestFrame(val, cb) {
    db.ref("users/" + user + "/latestFrame").set(val, () => {
        if (cb) cb();
    });
}
// ============================= MAIN APP FUNCTIONS ============================
function handleLatestData() {
    data.innerHTML = getDataString();
    if (latestData === 0) {
        header.style.background = "linear-gradient(rgba(244,67,54,1), rgba(0,0,0,0))";
        data.style.backgroundColor = "rgb(244,67,54)";
        [].forEach.call(document.getElementsByClassName("ldBar-label"), function (div) {
            div.style.backgroundColor = "rgb(244,67,54)";
        });
        document.getElementById("warrior").ldBar.set(0);
        document.getElementById("tree").ldBar.set(0);
        document.getElementById("triangle").ldBar.set(0);
    } else if (latestData === 1) {
        header.style.background = "linear-gradient(rgba(249,168,37,1), rgba(0,0,0,0))";
        data.style.backgroundColor = "rgb(249,168,37)";
        [].forEach.call(document.getElementsByClassName("ldBar-label"), function (div) {
            div.style.backgroundColor = "rgb(249,168,37)";
        });
        document.getElementById("warrior").ldBar.set(1);
        document.getElementById("tree").ldBar.set(1);
        document.getElementById("triangle").ldBar.set(1);
    } else {
        header.style.background = "linear-gradient(rgba(0,200,83,.45), rgba(0,0,0,0))";
        data.style.backgroundColor = "rgb(0,200,83)";
        [].forEach.call(document.getElementsByClassName("ldBar-label"), function (div) {
            div.style.backgroundColor = "rgb(0,200,83)";
        });
    }
}

function onGetUserMediaButtonClick() {
    mediaDevice.then(mediaStream => {
        document.querySelector("video").srcObject = mediaStream;
        const track = mediaStream.getVideoTracks()[0];
        imageCapture = new ImageCapture(track);
        onGrabFrameButtonClick();
    });
}

function onGrabFrameButtonClick() {
    imageCapture.grabFrame().then(imageBitmap => {
        drawCanvas(grabLatestFrame, imageBitmap, false);
        drawCanvas(grabLatestFrameData, imageBitmap, true);
    }).catch((err) => {});
}

function drawCanvas(canvas, img, upload) {
    if (updating) {
        canvas.width = getComputedStyle(canvas).width.split("px")[0];
        canvas.height = getComputedStyle(canvas).height.split("px")[0];
        let ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
        let x = (canvas.width - img.width * ratio) / 2;
        let y = (canvas.height - img.height * ratio) / 2;
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        canvas.getContext("2d").drawImage(img, 0, 0, img.width, img.height, x, y, img.width * ratio, img.height * ratio);
    }
    if (upload) updateLatestFrame(canvas.toDataURL(), () => {
        onGrabFrameButtonClick();
    });
}
// ========================== TENSORFLOW.JS FUNCTIONS ==========================
function trainModel(cb) {
    canPredict = false;
    var time = Date.now();
    console.log("Training model...");
    // TODO: PUT IN CODE FOR TRAINING MODEL
    console.log("Finishing training model in " + (Date.now() - time) + "ms!");
    canPredict = true;
    if (cb) cb();
}

function runTensorflow(data, image) {
    if (canPredict) {
        console.log("Model training is not complete; trying later...");
        return;
    }
    console.log("Running Tensorflow with:");
    console.log("data");
    console.log(data);
    // TODO: Need to put in code to run Tensorflow.JS
}
// ============================= HELPER FUNCTIONS ==============================
function updateStuff() {
    var time = convertMS(Date.now() - lastTime);
    lastUpdated.innerHTML = "Yoga Master | Last updated: " + time.m + "m " + time.s + "s";
}

function resize() {
    updateDims(getReSize());
}

function getReSize() {
    return [video.videoWidth, video.videoHeight];
}

function getDataString() {
    if (latestData === 0) return "No person detected in frame...";
    else if (latestData === 1) return "Please get your entire body in frame!";
    var rtrn = "";
    for (var row in latestData) rtrn += "\'" + row + "\': " + latestData[row] + " | "; //rtrn += "\'"+angleNames[angle]+"\': "+latestData[angle]+" | ";
    return rtrn.slice(0, -2);
}

function convertMS(ms) {
    var d, h, m, s;
    s = Math.floor(ms / 1000);
    m = Math.floor(s / 60);
    s = s % 60;
    h = Math.floor(m / 60);
    m = m % 60;
    d = Math.floor(h / 24);
    h = h % 24;
    return {
        d: d,
        h: h,
        m: m,
        s: s
    };
}
// ================ OLD CODE USED FOR TESTING AND UNDERSTANDING ================
// firebase serve -o $IP -p 8080 | browser-sync start --proxy 0.0.0.0:8080 --port 8081 --files "src/**/*"
// lastUpdated.innerHTML = "Last updated: "+(Date.now() - lastTime)+"ms";
// lastUpdated.innerHTML = "Last updated "+Math.round((Date.now() - lastTime)/1000)+" seconds ago, @ "+(new Date(lastTime)).toLocaleString();
// firebase.initializeApp({
//     apiKey: "AIzaSyBMoovddhJJI0mJB1Y_e6ofNSYprmsCGFg",
//     authDomain: "yoga-master-app.firebaseapp.com",
//     databaseURL: "https://yoga-master-app.firebaseio.com",
//     projectId: "yoga-master-app",
//     storageBucket: "",
//     messagingSenderId: "728299532737"
// });
// return [window.innerWidth || document.documentElement.clientWidth || document.getElementsByTagName('body')[0].clientWidth,
// window.innerHeight|| document.documentElement.clientHeight|| document.getElementsByTagName('body')[0].clientHeight]
// lastUpdated.innerHTML = "YOGA MASTERS | Last updated: "+time.h+"h "+time.m+"m "+time.s+"s";