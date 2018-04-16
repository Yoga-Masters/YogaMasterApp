// ============================= GLOBALS SETUP =================================
// firebase serve -o $IP -p 8080 | browser-sync start --proxy 0.0.0.0:8080 --port 8081 --files "src/**/*"
var db;
var ui;
var auth;
var user;
var updating;
var lastTime;
var mediaDevice;
var latestAngles;
var imageCapture;
var btn = document.getElementById("btn");
var angles = document.getElementById("angles");
var welcome = document.getElementById("welcome");
var lastUpdated = document.getElementById("lastUpdated");
var openposeFrame = document.getElementById("openposeCanvas");
var tensorflowFrame = document.getElementById("tensorCanvas");
var grabLatestFrame = document.getElementById("grabFrameCanvas");
var angleNames = ["neck", "l_shoulder", "r_shoulder", "l_arm", "r_arm", "l_farm", "r_farm", "l_spine", "r_spine", "l_thigh", "r_thigh", "l_leg", "r_leg"]
// ============================ FIREBASE SETUP =================================
function initApp() {
    trainModel();
    auth = firebase.auth();
    db = firebase.database();
    ui = new firebaseui.auth.AuthUI(auth);
    ui.start('#firebaseui-auth-container', {
        "signInFlow": 'popup',
        "signInOptions": [firebase.auth.GoogleAuthProvider.PROVIDER_ID],
        "callbacks": {
            "uiShown": () => { document.getElementById('loader').style.display = 'none'; return false; },
            "signInSuccess": (currentUser, credential, redirectUrl) => {
                var time = Date.now();
                user = currentUser.uid;
                console.log("Logging in as "+currentUser.displayName+" with id "+user+"...");
                ensureUserExists(user, currentUser.displayName, time, () => { setupAppAndListeners(() => {
                    // grabLatestFrame.style.height = "100px";
                    setInterval(updateStuff, 1000);
                    resize();
                    window.onresize = resize;
                    btn.addEventListener("click", () => { updateUpdating(!updating); });
                    mediaDevice = navigator.mediaDevices.getUserMedia({ video: true });
                    onGetUserMediaButtonClick();
                    document.getElementById('background').style.display = 'none';
                    console.log("Setup app in "+(Date.now() - time)+"ms"); 
                }); });
                return false;
            }
        }
    });
}
// ========================= PASSIVE FIREBASE FUNCTIONS ========================
function setupAppAndListeners(cb) {
    db.ref("users/" + user).once("value", (snap) => {
        var data = snap.val();
        lastTime = data.lastUpdated;
        latestAngles = data.latestTensorData.angles;
        angles.innerHTML = getAnglesString();
        welcome.innerHTML = "Welcome "+data.name;
        openposeFrame.setAttribute("src", data.latestOpenPoseFrame);
        tensorflowFrame.setAttribute("src", data.latestTensorData.latestProcessedFrame);
        updateUpdating(false, () => { cb(); });
    });
    db.ref("users/" + user + "/latestOpenPoseFrame").on("value", (snap) => { openposeFrame.setAttribute("src", snap.val()); });
    db.ref("users/" + user + "/lastUpdated").on("value", (snap) => { lastTime = snap.val(); });
    db.ref("users/" + user + "/updating").on("value", (snap) => { updating = snap.val(); });
    db.ref("users/" + user + "/dimensions").on("value", (snap) => {
        // grabLatestFrame.style.width = (100*(snap.val()[0] / snap.val()[1]))+"px"; 
        angles.style.left = (100*(snap.val()[0] / snap.val()[1])+20)+"px";
    });
    db.ref("users/" + user + "/latestTensorData").on("value", snap => {
        var data = snap.val();
        latestAngles = data.angles;
        runTensorflow(latestAngles, data.latestProcessedFrame);
        angles.innerHTML = getAnglesString();
        tensorflowFrame.setAttribute("src", data.latestProcessedFrame);
    });
    db.ref("users/" + user + "/latestConfidences").on("value", snap => {
        var data = snap.val();
        console.log(data);
    });
}
function ensureUserExists(user, name, time, cb) {
    db.ref("users/").child(user).once('value', snap => {
        if(snap.val() == null) {
            console.log("User "+name+" with id "+user+" did not exist before! Creating now...");
            db.ref("users/"+user).set({
                "key": user,
                "lastUpdated": time,
                "name": name,
                "updating": false,
                "dimensions": getReSize(),
                "latestOpenPoseFrame" : "",
                "latestTensorData": {
                    "angles": 0,
                    "latestProcessedFrame" : ""
                }, "latestConfidences": {
                    "tree": 0,
                    "triangle": 0,
                    "warriorii": 0
                }
            }, cb);
        } else cb();
    });
}
// ============================= MAIN APP FUNCTIONS ============================
function onGetUserMediaButtonClick() {
    mediaDevice.then(mediaStream => {
        document.querySelector('video').srcObject = mediaStream;
        const track = mediaStream.getVideoTracks()[0];
        imageCapture = new ImageCapture(track);
        onGrabFrameButtonClick();
    });
}
function onGrabFrameButtonClick() {
    imageCapture.grabFrame().then(imageBitmap => {
        drawCanvas(grabLatestFrame, imageBitmap);
    });
}
function drawCanvas(canvas, img) {
    if(updating) {
        canvas.width = getComputedStyle(canvas).width.split('px')[0];
        canvas.height = getComputedStyle(canvas).height.split('px')[0];
        let ratio = Math.min(canvas.width / img.width, canvas.height / img.height);
        let x = (canvas.width - img.width * ratio) / 2;
        let y = (canvas.height - img.height * ratio) / 2;
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        canvas.getContext('2d').drawImage(img, 0, 0, img.width, img.height, x, y, img.width * ratio, img.height * ratio);
    }
    updateLatestFrame(canvas.toDataURL(), () => {
        onGrabFrameButtonClick();
    });
}
// ============================= FIREBASE FUNCTIONS ============================
function updateUpdating(val, cb) {
    console.log("Updating recording to "+(val? "playing" : "stopped")+" @ "+(new Date()).toLocaleString()+"...");
    db.ref("users/" + user + "/updating").set(val, () => { if(cb) cb(); });
}
function updateDims(val, cb) {
    console.log("Updating window dimensions to "+ val[0] + ' × ' + val[1]);
    db.ref("users/" + user + "/dimensions").set(val, () => { if(cb) cb(); });
}
function updateLatestFrame(val, cb) {
    db.ref("users/" + user + "/latestFrame").set(val, () => { if(cb) cb(); });
}
// ========================== TENSORFLOW.JS FUNCTIONS ==========================
function trainModel() {
    var time = Date.now();
    console.log("Training model...");
    console.log("Finishing training model in "+(Date.now()-time)+"ms!");
}
function runTensorflow(angles, image) {
    console.log("Running Tensorflow with:");
    console.log("angles");
    console.log(angles);
    // console.log("image");
    // console.log(image);
    // Need to put in code to run Tensorflow.JS
}
// ============================= HELPER FUNCTIONS ==============================
function updateStuff() {
    var time = convertMS(Date.now() - lastTime);
    lastUpdated.innerHTML = "YOGA MASTERS | Last updated: "+time.m+"m "+time.s+"s";
    // lastUpdated.innerHTML = "YOGA MASTERS | Last updated: "+time.h+"h "+time.m+"m "+time.s+"s";
}
function resize() {
    updateDims(getReSize());
}
function getReSize() {
    return [window.innerWidth || document.documentElement.clientWidth || document.getElementsByTagName('body')[0].clientWidth,
            window.innerHeight|| document.documentElement.clientHeight|| document.getElementsByTagName('body')[0].clientHeight]
}
function getAnglesString() {
    var rtrn = "";
    for(var angle in latestAngles) rtrn += "\'"+angleNames[angle]+"\': "+latestAngles[angle]+" | ";
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
    return { d: d, h: h, m: m, s: s };
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