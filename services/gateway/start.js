const app = require("./server.js");

app.listen(8084, 'gateway', (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Gateway api service workin on ${address}`);
});