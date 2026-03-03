const ollamaClass = require('ollama');
const ollama = new ollamaClass.Ollama();
const expressRateLimit = require('express-rate-limit');
const lancedb = require("@lancedb/lancedb");
const path = require('path'); 
const createKnowledgeBaseRouter = require('./routes/knowledge-base');
const { spawn } = require('child_process');
const http = require('http');




const dotenv = require('dotenv');
dotenv.config();

// Function to check if Ollama is running
async function checkOllamaStatus() {
    return new Promise((resolve) => {
        const request = http.get('http://localhost:11434/api/tags', (res) => {
            resolve(res.statusCode === 200);
        });
        request.on('error', () => resolve(false));
        request.setTimeout(2000, () => {
            request.destroy();
            resolve(false);
        });
    });
}

// Function to start Ollama
function startOllama() {
    return new Promise((resolve, reject) => {
        console.log("🚀 Starting Ollama...");
        
        // Spawn Ollama based on platform
        const ollamaProcess = spawn('ollama', ['serve'], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });

        ollamaProcess.unref();

        // Give Ollama time to start
        const checkInterval = setInterval(async () => {
            const isRunning = await checkOllamaStatus();
            if (isRunning) {
                clearInterval(checkInterval);
                console.log("✅ Ollama is now running!");
                resolve();
            }
        }, 1000);

        // Timeout after 30 seconds
        setTimeout(() => {
            clearInterval(checkInterval);
            reject(new Error("Ollama failed to start within 30 seconds"));
        }, 30000);
    });
}

// Function to initialize Ollama on startup
async function initializeOllama() {
    try {
        console.log("🔍 Checking Ollama status...");
        const isRunning = await checkOllamaStatus();
        
        if (isRunning) {
            console.log("✅ Ollama is already running!");
        } else {
            await startOllama();
        }

        // Pull the required model
        console.log("📥 Ensuring ministral-3:3b model is available...");
        await ollama.pull({
            model: 'ministral-3:3b',
            stream: false
        });
        console.log("✅ ministral-3:3b model is ready!");

    } catch (error) {
        console.error("⚠️ Warning: Could not initialize Ollama:", error.message);
        console.log("Please ensure Ollama is installed and accessible from your PATH.");
    }
}

const express = require('express');
const app = express();
const port = 8080 || process.env.PORT;
const validAuthKey = process.env.AUTH_KEY;
const multer = require('multer');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });
const pythonExecutable = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
const processPdfScriptPath = path.join(__dirname, 'process_pdf.py');
const aiPipelineScriptPath = path.join(__dirname, 'ai_pipeline.py');

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

const rateLimit = expressRateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10, 
    message: "Too many requests, please try again later."
})


app.use(express.json());
app.use(express.static(path.join(__dirname, 'src')));
app.use(createKnowledgeBaseRouter({ validAuthKey, lancedb, ollama }));

app.get('/', (req, res) => {
    res.send('Server is online.')
})

const runPythonJson = (scriptPath, args) => {
    return new Promise((resolve, reject) => {
        const pythonProcess = spawn(pythonExecutable, [scriptPath, ...args]);
        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                return reject(new Error(stderr || stdout || `Python exited with code ${code}`));
            }

            const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean);
            const lastLine = lines[lines.length - 1] || '{}';

            try {
                const payload = JSON.parse(lastLine);
                return resolve(payload);
            } catch (error) {
                return reject(new Error(`Invalid JSON from python: ${lastLine}`));
            }
        });
    });
};

app.post('/ask-ai', rateLimit, async (req, res) => {
    const authKey = req.headers['x-auth-key'];
    const { message } = req.body;

    if(authKey !== validAuthKey) {
        return res.status(401).json({
            message : 'Authentication key is invalid.'
        });
    }

    try {
        const result = await runPythonJson(aiPipelineScriptPath, ['--mode', 'plain', '--message', message]);
        return res.status(200).json({
            message: result.message,
            model: result.model,
            timestamp: result.timestamp,
        });
    } catch (error) {
        console.error('Plain AI route error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }

})

const handlePdfUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No PDF file uploaded.' });
        }

        const filePath = req.file.path;
        console.log(`Received PDF: ${req.file.originalname}`);

        const pythonProcess = spawn(pythonExecutable, [processPdfScriptPath, filePath, req.file.originalname]);

        let output = '';
        let errorOutput = '';

        pythonProcess.stdout.on('data', (data) => {
            const out = data.toString();
            console.log(out);
            output += out;
        });

        pythonProcess.stderr.on('data', (data) => {
            const err = data.toString();
            console.error(err);
            errorOutput += err;
        });

        pythonProcess.on('close', (code) => {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            if (code !== 0) {
                console.error(`Python script exited with code ${code}`);
                return res.status(500).json({ error: 'Failed to process PDF', details: errorOutput });
            }
            res.status(200).json({ message: 'PDF processed and uploaded successfully.', output });
        });

    } catch (error) {
        console.error("PDF Upload Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

app.post('/upload-knowledge-base', upload.single('file'), handlePdfUpload);
app.post('/upload-pdf', upload.single('pdf'), handlePdfUpload);

app.post('/ask-ai-with-vector-stream', async (req, res) => {
    const authKey = req.headers['x-auth-key'];
    const { message } = req.body;

    if (authKey !== validAuthKey) {
        return res.status(401).json({ message: 'Authentication key is invalid.' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const pythonProcess = spawn(pythonExecutable, [
        aiPipelineScriptPath,
        '--mode', 'rag_stream',
        '--message', message,
    ]);

    pythonProcess.stdout.on('data', (data) => {
        res.write(data.toString());
    });

    pythonProcess.stderr.on('data', (data) => {
        console.error(`AI stream stderr: ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
        if (code !== 0 && !res.writableEnded) {
            res.write(`${JSON.stringify({ type: 'error', message: `Python stream exited with code ${code}` })}\n`);
        }
        if (!res.writableEnded) {
            res.end();
        }
    });
});

app.post('/ask-ai-with-vector', async (req, res) => {
    const authKey = req.headers['x-auth-key'];
    const { message } = req.body;
    // console.log('here')

    if (authKey !== validAuthKey) {
        return res.status(401).json({ message: 'Authentication key is invalid.' });
    }

    try {
        const result = await runPythonJson(aiPipelineScriptPath, ['--mode', 'rag', '--message', message]);

        res.json(result);

    } catch (error) {
        console.error("Endpoint Error:", error);
        if (!res.headersSent) res.status(500).send("Internal Server Error");
        else res.end();
    }
});

// Start server only after Ollama and model are ready
(async () => {
    try {
        await initializeOllama();
        app.listen(port, () => {
            console.log(`✅ Server is online on port: ${port}`);
            console.log("🤖 Ready to handle requests!");
        });
    } catch (error) {
        console.error("❌ Failed to initialize Ollama. Server not started:", error.message);
        process.exit(1);
    }
})()