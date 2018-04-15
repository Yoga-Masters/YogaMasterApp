// ============================= GLOBALS SETUP =================================
// firebase serve -o $IP -p 8080 | browser-sync start --proxy 0.0.0.0:8080 --port 8081 --files "src/**/*"
var db;
var auth;
var user;
var updating;
var lastTime;
var latestAngles;
var angles = document.getElementById("angles");
var welcome = document.getElementById("welcome");
var lastUpdated = document.getElementById("lastUpdated");
var openposeFrame = document.getElementById("openposeCanvas");
var tensorflowFrame = document.getElementById("tensorCanvas");
var angleNames = ["neck", "l_shoulder", "r_shoulder", "l_arm", "r_arm", "l_farm", "r_farm", "l_spine", "r_spine", "l_thigh", "r_thigh", "l_leg", "r_leg"]
// ============================ FIREBASE SETUP =================================
function initApp() {
    auth = firebase.auth();
    db = firebase.database();
    user = "key";
    setupAppAndListeners(() => {
        setInterval(updateTime, 1000);
    });
}
// ========================= PASSIVE FIREBASE FUNCTIONS ========================
function setupAppAndListeners(cb) {
    db.ref("users/" + user).once("value", (snap) => {
        var time = Date.now();
        var data = snap.val();
        updating = data.updating;
        lastTime = data.lastUpdated;
        latestAngles = data.latestTensorData.angles;
        angles.innerHTML = getAnglesString();
        welcome.innerHTML = "Welcome, "+data.name;
        openposeFrame.setAttribute("src", data.latestOpenPoseFrame);
        tensorflowFrame.setAttribute("src", data.latestTensorData.latestProcessedFrame);
        updateUpdating(updating, () => { console.log("Setup app in "+(Date.now() - time)+"ms"); cb(); });
    });
    db.ref("users/" + user + "/updating").on("value", (snap) => { updating = snap.val(); });
    db.ref("users/" + user + "/lastUpdated").on("value", (snap) => { lastTime = snap.val(); });
    db.ref("users/" + user + "/latestOpenPoseFrame").on("value", (snap) => { openposeFrame.setAttribute("src", snap.val()); });
    db.ref("users/" + user + "/latestTensorData/latestProcessedFrame").on("value", (snap) => { tensorflowFrame.setAttribute("src", snap.val()); });
    db.ref("users/" + user + "/latestTensorData/angles").on("value", (snap) => { latestAngles = snap.val(); angles.innerHTML = getAnglesString(); });
}
// ============================= MAIN APP FUNCTIONS ============================
// Need to put in code to update the latestFrame
// ============================= FIREBASE FUNCTIONS ============================
function updateUpdating(val, cb) {
    db.ref("users/" + user + "/updating").set(val, () => { cb(); });
}
// ========================== TENSORFLOW.JS FUNCTIONS ==========================
// Need to put in code to run Tensorflow.JS
// ============================= HELPER FUNCTIONS ==============================
function getAnglesString() {
    var rtrn = "";
    for(angle in latestAngles) rtrn += angleNames[angle]+": "+latestAngles[angle]+", ";
    return rtrn.slice(0, -2);
}

function updateTime() {
    var time = convertMS(Date.now() - lastTime);
    lastUpdated.innerHTML = "Last updated: "+time.h+"h "+time.m+"m "+time.s+"s";
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
};
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