//Two functions to use for the app below; one to train, one to predict
function getTrainedModel(tData, config) { // Returns a trained model, takes care of chance of high loss by recursion
    return new Promise(async function(resolve) {
        const [xTrain, yTrain, xTest, yTest] = getPreppedTrainingData(config[0], tData[1], tData[0], tData[0].length);
        await trainModel(xTrain, yTrain, xTest, yTest, {
            "epochs": config[2],
            "learningRate": config[1]
        }, (model, accuracy, loss) => {
            if (accuracy >= config[3] && loss <= config[4]) resolve({ "model": model, "accuracy": accuracy, "loss": loss });
            else {
                console.log("Model not good enough, training again: ", "accuracy: " + accuracy + (accuracy >= config[3] ? " → ✓" : " → ✖"), "loss: " + loss + (loss <= config[4] ? " → ✓" : " → ✖"));
                getTrainedModel(tData, config).then(mdl => {
                    resolve(mdl);
                });
            }
        });
    });
}
// Returns confidences using global model
function getConfidences(model, data) {
    return new Promise(function(resolve) { predictOnManualInput(model, data, data.length, logits => { resolve(logits); }); });
}
//All functions below used as tensorflow library
async function trainModel(xTrain, yTrain, xTest, yTest, params, cb) {
    var time = Date.now();
    console.log("Training model @ " + (new Date(time)).toLocaleTimeString() + " on angles_magnitudes data. Training using a " + params.learningRate + " learning rate for " + params.epochs + " epochs; please wait...");
    const model = tf.sequential();
    model.add(tf.layers.dense({
        units: 10,
        activation: 'sigmoid',
        inputShape: [xTrain.shape[1]]
    }));
    model.add(tf.layers.dense({
        units: yTrain.shape[1],
        activation: 'softmax'
    }));
    const optimizer = tf.train.adam(params.learningRate);
    model.compile({
        optimizer: optimizer,
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy'],
    });
    const lossValues = [];
    const accuracyValues = [];
    await model.fit(xTrain, yTrain, {
        epochs: params.epochs,
        callbacks: { onEpochEnd: async (epoch, logs) => { await tf.nextFrame(); } }
    }).then((value) => {
        console.log("Model training complete @ " + (new Date(Date.now())).toLocaleTimeString() + ", in " + (Date.now() - time) + " ms; AKA: " + convertMS(Date.now() - time).m + " mins " + convertMS(Date.now() - time).s + " seconds.");
        cb(model, value.history.acc.pop(), value.history.loss.pop());
    });
}

function getPreppedTrainingData(testSplit, data, classes, numClasses) {
    console.log("Prepping data for training with labels = " + JSON.stringify(classes) + ", length = " + numClasses + " with a " + testSplit * 100 + "% test-to-data split.");
    return tf.tidy(() => {
        const dataByClass = [];
        const targetsByClass = [];
        for (let i = 0; i < classes.length; ++i) {
            dataByClass.push([]);
            targetsByClass.push([]);
        }
        for (const example of data) {
            const target = example[example.length - 1];
            const data = example.slice(0, example.length - 1);
            dataByClass[target].push(data);
            targetsByClass[target].push(target);
        }
        const xTrains = [];
        const yTrains = [];
        for (let i = 0; i < classes.length; ++i) {
            const [xTrain, yTrain, xTest, yTest] = convertToTensors(dataByClass[i], targetsByClass[i], testSplit, numClasses);
            xTrains.push(xTrain);
            yTrains.push(yTrain);
        }
        const concatAxis = 0;
        return [
            tf.concat(xTrains, concatAxis),
            tf.concat(yTrains, concatAxis)
        ];
    });
}

function predictOnManualInput(model, inputData, length, cb) {
    tf.tidy(() => {
        const input = tf.tensor2d([inputData], [1, length]);
        const predictOut = model.predict(input);
        var logits = Array.from(predictOut.dataSync()).map(x => Number.parseFloat(Number.parseFloat(x).toFixed(3)));
        cb(logits);
    });
}

function convertToTensors(data, targets, testSplit, numClasses) {
    const numExamples = data.length;
    if (numExamples !== targets.length) throw new Error('Data and Split have different # of examples');
    const numTestExamples = Math.round(numExamples * testSplit);
    const numTrainExamples = numExamples - numTestExamples;
    const xDims = data[0].length;
    const xs = tf.tensor2d(data, [numExamples, xDims]);
    const ys = tf.oneHot(tf.tensor1d(targets), numClasses);
    const xTrain = xs.slice([0, 0], [numTrainExamples, xDims]);
    const xTest = xs.slice([numTrainExamples, 0], [numTestExamples, xDims]);
    const yTrain = ys.slice([0, 0], [numTrainExamples, numClasses]);
    const yTest = ys.slice([0, 0], [numTestExamples, numClasses]);
    return [xTrain, yTrain, xTest, yTest];
}