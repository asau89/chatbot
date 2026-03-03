const URL = 'http://localhost:8080/ask-ai';
const AUTH_KEY = 'SDP-AI-SERVER';

async function sendRequest(i) {
    try {
        const start = Date.now();
        const res = await fetch(URL, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-auth-key': AUTH_KEY 
            },
            body: JSON.stringify({ message: "Hello AI" })
        });
        console.log(`Req ${i}: Status ${res.status} (${Date.now() - start}ms)`);
    } catch (err) {
        console.error(`Req ${i}: Failed`);
    }
}

async function run(){
    // Simulate 100 rapid-fire requests
    for (let i = 0; i < 100; i++) {
        await sendRequest(i);
    }
}


run()