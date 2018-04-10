// firebase serve -p 5000 | browser-sync start --proxy localhost:5000 --files "**/*"

function setupFirebase() {
    firebase.initializeApp({
        apiKey: "AIzaSyBMoovddhJJI0mJB1Y_e6ofNSYprmsCGFg",
        authDomain: "yoga-master-app.firebaseapp.com",
        databaseURL: "https://yoga-master-app.firebaseio.com",
        projectId: "yoga-master-app",
        storageBucket: "",
        messagingSenderId: "728299532737"
    });
}