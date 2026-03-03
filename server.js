const ollamaClass = require('ollama');
const ollama = new ollamaClass.Ollama();
const expressRateLimit = require('express-rate-limit');
const lancedb = require("@lancedb/lancedb");
const path = require('path'); 
const multer = require('multer');
const pdfParse = require('pdf-parse');




const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const app = express();
const port = 8080 || process.env.PORT;
const validAuthKey = process.env.AUTH_KEY;
const rateLimit = expressRateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 10, 
    message: "Too many requests, please try again later."
})


app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.static(path.join(__dirname, 'src')));

app.get('/', (req, res) => {
    res.send('Server is online.')
})

app.post('/upload-knowledge-base', upload.single('file'), async(req, res) =>{
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }
        const uint8Array = new Uint8Array(req.file.buffer);
        const pdf = new pdfParse.PDFParse(uint8Array);
        const data = await pdf.getText();

        

        res.status(200).json({ 
            success: true, 
            message : 'The server receive the file'
        });
    } catch (err) {
        console.log(err.message)
        res.status(500).json({ error: "Failed to parse PDF" });
    }
})

app.post('/ask-ai', rateLimit, async (req, res) => {
    const authKey = req.headers['x-auth-key'];
    // console.log(authKey)
    const { message } = req.body;
    const isAuthKeyValid = authKey === validAuthKey;
    const payload = {
        model : 'ministral-3:3b',
        messages : [{
            role : 'user',
            content : message
        }]
    }

    // console.log(`Client's Key: ${authKey} \nValid Key: ${validAuthKey}`)
    if(!isAuthKeyValid) {
        return res.status(401).json({
            message : 'Authentication key is invalid.'
        });
    }

    const response = await ollama.chat(payload);

    return res.status(200).json({
        message : response.message.content
    });

})

app.post('/ask-ai-with-vector', async (req, res) => {
    const authKey = req.headers['x-auth-key'];
    const { message } = req.body;
    // console.log('here')

    if (authKey !== validAuthKey) {
        return res.status(401).json({ message: 'Authentication key is invalid.' });
    }

    try {
        const db = await lancedb.connect("data/vector-db");
        const table = await db.openTable("knowledge_base");


        const embedRes = await ollama.embeddings({
            model: 'nomic-embed-text',
            prompt: message,
        });

        const searchResults = await table.search(embedRes.embedding).limit(5).select(['text']).toArray();

        const contextText = searchResults
            .map(r => `[Text: ${r.text}] [Keywords: ${r.keywords || 'N/A'}]`)
            .join("\n---\n");

        const prompt = `
            You are a helpful assistant. Answer the question using ONLY the context provided below.

            CONTEXT:
            ${contextText}

            QUESTION:
            ${message}

            FORMATTING INSTRUCTIONS:
            - Your response must be written entirely in Markdown format.
            - **Extreme Breathability**: Ensure there is a full empty line (double line break) between EVERY single sentence or bullet point.
            - Use headers (##) to separate different topics.
            - Use bold text for key terms to make them stand out.
            - Keep paragraphs extremely short (1-2 sentences max).
            - Provide ONLY the Markdown content; no introductory or closing filler.

        `;


        const response = await ollama.chat({
            model: 'ministral-3:3b',
            messages: [{ role: 'user', content: prompt }],
            stream: false, // Ensure streaming is off
        });

        // Send as a JSON object
        res.json({
            success: true,
            model: 'ministral-3:3b',
            response : response.message.content,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error("Endpoint Error:", error);
        if (!res.headersSent) res.status(500).send("Internal Server Error");
        else res.end();
    }
});

app.listen(port, () => {
    console.log(`Server is online on port: ${port}`)
})