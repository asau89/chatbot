const lancedb = require("@lancedb/lancedb");
const { Ollama } = require("ollama");

const ollama = new Ollama();

async function uploadData() {
    try {
        console.log("🚀 Connecting to LanceDB...");
        const db = await lancedb.connect("data/vector-db");

        const policyData = [
            {
                text: "Employees must be online and available on Slack between 10:00 AM and 3:00 PM EST.",
                keywords: "availability, core hours, slack",
                label: "attendance"
            },
            {
                text: "The company provides a $500 stipend for home office equipment every 24 months.",
                keywords: "stipend, equipment, home office",
                label: "benefits"
            },
            {
                text: "Requests for full-time remote work must be submitted to HR 30 days in advance.",
                keywords: "request, HR, approval",
                label: "procedure"
            },
            {
                text: "Security protocols: Use the company VPN at all times when accessing internal servers.",
                keywords: "security, VPN, privacy",
                label: "security"
            }
        ];

        console.log("Vectorizing and Overwriting Database...");

        const dataForDb = [];
        
        for (const item of policyData) {
            const response = await ollama.embeddings({
                model: 'nomic-embed-text',
                prompt: item.text,
            });

            dataForDb.push({
                vector: response.embedding,
                text: item.text,
                keywords: item.keywords, 
                label: item.label,       
                id: dataForDb.length + 1
            });
            process.stdout.write(".");
        }


        await db.createTable("knowledge_base", dataForDb, { mode: 'overwrite' });

        console.log("\n✅ Database Refreshed! Old embeddings erased and Policy uploaded.");

    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

uploadData();