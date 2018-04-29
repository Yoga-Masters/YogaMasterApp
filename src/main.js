// cls && browser-sync start --proxy 0.0.0.0:5000 --port 5001 --files "src/**/*" | firebase serve
// clear && browser-sync start --proxy 0.0.0.0:8080 --port 8081 --files "src/**/*" | firebase serve -o $IP -p 8080
// cls && firebase serve -p 81 | browser-sync start --proxy 0.0.0.0:81 --port 8081 --files "src/**/*" | ngrok http --bind-tls "both" 81
// ============================= GLOBALS SETUP =================================
var db;
var ui;
var auth;
var user;
var types;
let model;
var updating;
var lastTime;
var canPredict;
var latestData;
var confidences;
var mediaDevice;
var selectedType;
var imageCapture;
var latestTrainFrame;
var poseIndex = {
    "warriorii": 0,
    "tree": 1,
    "triangle": 2
};
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
// ============================ FIREBASE SETUP =================================
function initApp() {
    auth = firebase.auth();
    db = firebase.database();
    var trainingfb = firebase.initializeApp({
        apiKey: "AIzaSyBfzO0wkhLUX0sSKeQi1d7uMvvJrf7Ti4s",
        authDomain: "yoga-master-training-db.firebaseapp.com",
        databaseURL: "https://yoga-master-training-db.firebaseio.com",
        projectId: "yoga-master-training-db"
    }, "trainingdb");
    tdb = trainingfb.database();
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
                        trainModel(() => {
                            setInterval(updateTime, 1000);
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
        data.style.right = (100 * (snap.val()[0] / snap.val()[1]) + 130) + "px";
    });
    db.ref("users/" + user + "/latestTensorData").on("value", snap => {
        var snapshot = snap.val();
        latestData = snapshot[selectedType];
        latestTrainFrame = snapshot.latestProcessedFrame;
        tensorflowFrame.setAttribute("src", snapshot.latestProcessedFrame);
        runTensorflow(latestData, latestTrainFrame);
        handleLatestData();
    });
    db.ref("users/" + user + "/latestConfidences").on("value", snap => {
        confidences = snap.val();
        document.getElementById("warrior").ldBar.set(confidences.warriorii * 100);
        document.getElementById("tree").ldBar.set(confidences.tree * 100);
        document.getElementById("triangle").ldBar.set(confidences.triangle * 100);
        handleLatestData();
    });
}
// ============================= FIREBASE FUNCTIONS ============================
function getTrainingData() {
    tdb.ref("frames").once("value", snap => {
        var data = snap.val();
        var trainingData = {};
        trainingData["DEFAULT_CLASSES"] = ['Iris-setosa', 'Iris-versicolor', 'Iris-virginica'];
        trainingData["DEFAULT_NUM_CLASSES"] = trainingData["DEFAULT_CLASSES"].length;
        trainingData["DEFAULT_DATA"] = JSON.parse("{\"data\": [[5.1, 3.5, 1.4, 0.2, 0], [4.9, 3.0, 1.4, 0.2, 0], [4.7, 3.2, 1.3, 0.2, 0], [4.6, 3.1, 1.5, 0.2, 0], [5.0, 3.6, 1.4, 0.2, 0], [5.4, 3.9, 1.7, 0.4, 0], [4.6, 3.4, 1.4, 0.3, 0], [5.0, 3.4, 1.5, 0.2, 0], [4.4, 2.9, 1.4, 0.2, 0], [4.9, 3.1, 1.5, 0.1, 0], [5.4, 3.7, 1.5, 0.2, 0], [4.8, 3.4, 1.6, 0.2, 0], [4.8, 3.0, 1.4, 0.1, 0], [4.3, 3.0, 1.1, 0.1, 0], [5.8, 4.0, 1.2, 0.2, 0], [5.7, 4.4, 1.5, 0.4, 0], [5.4, 3.9, 1.3, 0.4, 0], [5.1, 3.5, 1.4, 0.3, 0], [5.7, 3.8, 1.7, 0.3, 0], [5.1, 3.8, 1.5, 0.3, 0], [5.4, 3.4, 1.7, 0.2, 0], [5.1, 3.7, 1.5, 0.4, 0], [4.6, 3.6, 1.0, 0.2, 0], [5.1, 3.3, 1.7, 0.5, 0], [4.8, 3.4, 1.9, 0.2, 0], [5.0, 3.0, 1.6, 0.2, 0], [5.0, 3.4, 1.6, 0.4, 0], [5.2, 3.5, 1.5, 0.2, 0], [5.2, 3.4, 1.4, 0.2, 0], [4.7, 3.2, 1.6, 0.2, 0], [4.8, 3.1, 1.6, 0.2, 0], [5.4, 3.4, 1.5, 0.4, 0], [5.2, 4.1, 1.5, 0.1, 0], [5.5, 4.2, 1.4, 0.2, 0], [4.9, 3.1, 1.5, 0.1, 0], [5.0, 3.2, 1.2, 0.2, 0], [5.5, 3.5, 1.3, 0.2, 0], [4.9, 3.1, 1.5, 0.1, 0], [4.4, 3.0, 1.3, 0.2, 0], [5.1, 3.4, 1.5, 0.2, 0], [5.0, 3.5, 1.3, 0.3, 0], [4.5, 2.3, 1.3, 0.3, 0], [4.4, 3.2, 1.3, 0.2, 0], [5.0, 3.5, 1.6, 0.6, 0], [5.1, 3.8, 1.9, 0.4, 0], [4.8, 3.0, 1.4, 0.3, 0], [5.1, 3.8, 1.6, 0.2, 0], [4.6, 3.2, 1.4, 0.2, 0], [5.3, 3.7, 1.5, 0.2, 0], [5.0, 3.3, 1.4, 0.2, 0], [7.0, 3.2, 4.7, 1.4, 1], [6.4, 3.2, 4.5, 1.5, 1], [6.9, 3.1, 4.9, 1.5, 1], [5.5, 2.3, 4.0, 1.3, 1], [6.5, 2.8, 4.6, 1.5, 1], [5.7, 2.8, 4.5, 1.3, 1], [6.3, 3.3, 4.7, 1.6, 1], [4.9, 2.4, 3.3, 1.0, 1], [6.6, 2.9, 4.6, 1.3, 1], [5.2, 2.7, 3.9, 1.4, 1], [5.0, 2.0, 3.5, 1.0, 1], [5.9, 3.0, 4.2, 1.5, 1], [6.0, 2.2, 4.0, 1.0, 1], [6.1, 2.9, 4.7, 1.4, 1], [5.6, 2.9, 3.6, 1.3, 1], [6.7, 3.1, 4.4, 1.4, 1], [5.6, 3.0, 4.5, 1.5, 1], [5.8, 2.7, 4.1, 1.0, 1], [6.2, 2.2, 4.5, 1.5, 1], [5.6, 2.5, 3.9, 1.1, 1], [5.9, 3.2, 4.8, 1.8, 1], [6.1, 2.8, 4.0, 1.3, 1], [6.3, 2.5, 4.9, 1.5, 1], [6.1, 2.8, 4.7, 1.2, 1], [6.4, 2.9, 4.3, 1.3, 1], [6.6, 3.0, 4.4, 1.4, 1], [6.8, 2.8, 4.8, 1.4, 1], [6.7, 3.0, 5.0, 1.7, 1], [6.0, 2.9, 4.5, 1.5, 1], [5.7, 2.6, 3.5, 1.0, 1], [5.5, 2.4, 3.8, 1.1, 1], [5.5, 2.4, 3.7, 1.0, 1], [5.8, 2.7, 3.9, 1.2, 1], [6.0, 2.7, 5.1, 1.6, 1], [5.4, 3.0, 4.5, 1.5, 1], [6.0, 3.4, 4.5, 1.6, 1], [6.7, 3.1, 4.7, 1.5, 1], [6.3, 2.3, 4.4, 1.3, 1], [5.6, 3.0, 4.1, 1.3, 1], [5.5, 2.5, 4.0, 1.3, 1], [5.5, 2.6, 4.4, 1.2, 1], [6.1, 3.0, 4.6, 1.4, 1], [5.8, 2.6, 4.0, 1.2, 1], [5.0, 2.3, 3.3, 1.0, 1], [5.6, 2.7, 4.2, 1.3, 1], [5.7, 3.0, 4.2, 1.2, 1], [5.7, 2.9, 4.2, 1.3, 1], [6.2, 2.9, 4.3, 1.3, 1], [5.1, 2.5, 3.0, 1.1, 1], [5.7, 2.8, 4.1, 1.3, 1], [6.3, 3.3, 6.0, 2.5, 2], [5.8, 2.7, 5.1, 1.9, 2], [7.1, 3.0, 5.9, 2.1, 2], [6.3, 2.9, 5.6, 1.8, 2], [6.5, 3.0, 5.8, 2.2, 2], [7.6, 3.0, 6.6, 2.1, 2], [4.9, 2.5, 4.5, 1.7, 2], [7.3, 2.9, 6.3, 1.8, 2], [6.7, 2.5, 5.8, 1.8, 2], [7.2, 3.6, 6.1, 2.5, 2], [6.5, 3.2, 5.1, 2.0, 2], [6.4, 2.7, 5.3, 1.9, 2], [6.8, 3.0, 5.5, 2.1, 2], [5.7, 2.5, 5.0, 2.0, 2], [5.8, 2.8, 5.1, 2.4, 2], [6.4, 3.2, 5.3, 2.3, 2], [6.5, 3.0, 5.5, 1.8, 2], [7.7, 3.8, 6.7, 2.2, 2], [7.7, 2.6, 6.9, 2.3, 2], [6.0, 2.2, 5.0, 1.5, 2], [6.9, 3.2, 5.7, 2.3, 2], [5.6, 2.8, 4.9, 2.0, 2], [7.7, 2.8, 6.7, 2.0, 2], [6.3, 2.7, 4.9, 1.8, 2], [6.7, 3.3, 5.7, 2.1, 2], [7.2, 3.2, 6.0, 1.8, 2], [6.2, 2.8, 4.8, 1.8, 2], [6.1, 3.0, 4.9, 1.8, 2], [6.4, 2.8, 5.6, 2.1, 2], [7.2, 3.0, 5.8, 1.6, 2], [7.4, 2.8, 6.1, 1.9, 2], [7.9, 3.8, 6.4, 2.0, 2], [6.4, 2.8, 5.6, 2.2, 2], [6.3, 2.8, 5.1, 1.5, 2], [6.1, 2.6, 5.6, 1.4, 2], [7.7, 3.0, 6.1, 2.3, 2], [6.3, 3.4, 5.6, 2.4, 2], [6.4, 3.1, 5.5, 1.8, 2], [6.0, 3.0, 4.8, 1.8, 2], [6.9, 3.1, 5.4, 2.1, 2], [6.7, 3.1, 5.6, 2.4, 2], [6.9, 3.1, 5.1, 2.3, 2], [5.8, 2.7, 5.1, 1.9, 2], [6.8, 3.2, 5.9, 2.3, 2], [6.7, 3.3, 5.7, 2.5, 2], [6.7, 3.0, 5.2, 2.3, 2], [6.3, 2.5, 5.0, 1.9, 2], [6.5, 3.0, 5.2, 2.0, 2], [6.2, 3.4, 5.4, 2.3, 2], [5.9, 3.0, 5.1, 1.8, 2]]}").data;
        for (const type in types) trainingData[type] = [];
        for (const key of Object.keys(data))
            for (const type in types)
                if (data[key][type] && !(data[key][type] == 0 || data[key][type] == 1)) {
                    data[key][type].push(poseIndex[data[key].pose]);
                    trainingData[type].push(data[key][type]);
                }
        for (const type in types) {
            var dType = types[type].toUpperCase();
            trainingData[dType + "_CLASSES"] = Object.keys(poseIndex);
            trainingData[dType + "_NUM_CLASSES"] = trainingData[dType + "_CLASSES"].length;
            trainingData[dType + "_DATA"] = trainingData[type];
        }
        return trainingData;
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
                "dimensions": [0, 0],
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

function updateUpdating(val, cb) {
    resize();
    console.log("Updating recording to " + (val ? "playing" : "stopped") + ".") // @ " + (new Date()).toLocaleString() + "...");
    db.ref("users/" + user + "/updating").set(val, () => {
        if (cb) cb();
    });
}

function updateConfidences(warriorii, tree, triangle, cb) {
    console.log("Updating confidences; warriorii to " + warriorii + ", tree to " + tree + ", & triangle to " + triangle + ".");
    db.ref("users/" + user + "/latestConfidences").set({
        "warriorii": warriorii,
        "tree": tree,
        "triangle": triangle
    }, () => {
        if (cb) cb();
    });
}

function updateDims(val, cb) {
    console.log("Updating video dimensions to " + val[0] + " × " + val[1]);
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
async function iris() { // The main function of the Iris demo.
    const [xTrain, yTrain, xTest, yTest] = getIrisData(0.15);
    document.getElementById('train-from-scratch').addEventListener('click', async () => {
        model = await trainModel(xTrain, yTrain, xTest, yTest);
        evaluateModelOnTestData(model, xTest, yTest);
    });
    status('Standing by.');
    wireUpEvaluateTableCallbacks(() => predictOnManualInput(model));
}

function trainModel(cb) {
    var time = Date.now();
    canPredict = false;
    console.log("Training model with training data...");
    var trainData = getTrainingData();
    console.log(trainData);
    // TODO: PUT IN CODE FOR TRAINING MODEL
    // iris();
    console.log("Finished training model in " + (Date.now() - time) + "ms!");
    canPredict = true;
    if (cb) cb();
}

function runTensorflow(data, image) {
    if (canPredict) console.log("Model training is not complete; trying later...");
    else {
        console.log("Running Tensorflow with:");
        console.log(data);
        // TODO: Need to put in code to run Tensorflow.JS
        // Need to update confidences using updateConfidences(warriorii, tree, triangle, cb)
    }
}
// ============================= HELPER FUNCTIONS ==============================
function updateTime() {
    var time = convertMS(Date.now() - lastTime);
    lastUpdated.innerHTML = "Yoga Master | Last updated: " + time.m + "m " + time.s + "s";
}

function resize() {
    updateDims([video.videoWidth, video.videoHeight]);
}

function getDataString() {
    if (latestData === 0) return "No person detected in frame...";
    else if (latestData === 1) return "Please get your entire body in frame!";
    var rtrn;
    if (confidences) {
        var confs = Object.values(Object.assign({}, confidences)).map(x => Number.parseFloat(x));
        var maxIndx = confs.indexOf(Math.max.apply({}, confs));
        var maxPose = Object.keys(confidences)[maxIndx];
        var maxConf = Number.parseFloat(Object.values(confidences)[maxIndx]);
        if (maxConf < .5) rtrn = "I detected you, but not doing a specific pose..."
        else {
            rtrn = "I detected you doing " + maxPose + " pose! You're";
            if (maxConf < .6) rtrn += " kinda there...";
            else if (maxConf < .7) rtrn += "... not that bad at it!";
            else if (maxConf < .8) rtrn += " pretty good!";
            else if (maxConf < .9) rtrn += " <i>so</i> close to being perfect!";
            else rtrn += " a <b>Yoga Master</b> on " + maxPose + " pose!";
        }
        return rtrn;
    }
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