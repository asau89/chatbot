const express = require('express');

module.exports = function createKnowledgeBaseRouter({ validAuthKey, lancedb, ollama }) {
    const router = express.Router();

    router.get('/db-schema', async (req, res) => {
        const authKey = req.headers['x-auth-key'];
        if (validAuthKey && authKey !== validAuthKey) {
            return res.status(401).json({ message: 'Authentication key is invalid.' });
        }

        try {
            const db = await lancedb.connect('data/vector-db');
            const table = await db.openTable('knowledge_base');
            const schema = await table.schema();
            const fields = schema.fields.map((field) => ({
                name: field.name,
                type: field.type?.toString?.() || 'unknown',
                nullable: typeof field.nullable === 'boolean' ? field.nullable : true,
            }));

            return res.status(200).json({
                success: true,
                table: 'knowledge_base',
                fieldCount: fields.length,
                fields,
            });
        } catch (error) {
            console.error('DB schema route error:', error);
            return res.status(500).json({ message: 'Failed to fetch schema.' });
        }
    });

    router.post('/clear-knowledge-base', async (req, res) => {
        const authKey = req.headers['x-auth-key'];
        if (validAuthKey && authKey !== validAuthKey) {
            return res.status(401).json({ message: 'Authentication key is invalid.' });
        }

        try {
            const db = await lancedb.connect('data/vector-db');
            const table = await db.openTable('knowledge_base');
            const beforeCount = await table.countRows();

            await table.delete('true');
            const afterCount = await table.countRows();

            return res.status(200).json({
                success: true,
                message: 'Knowledge base cleared successfully.',
                beforeCount,
                afterCount,
            });
        } catch (error) {
            console.error('Clear knowledge base route error:', error);
            return res.status(500).json({ message: 'Failed to clear knowledge base.' });
        }
    });

    router.get('/db-chunks', async (req, res) => {
        const authKey = req.headers['x-auth-key'];
        if (validAuthKey && authKey !== validAuthKey) {
            return res.status(401).json({ message: 'Authentication key is invalid.' });
        }

        try {
            const db = await lancedb.connect('data/vector-db');
            const table = await db.openTable('knowledge_base');
            const rows = await table.query().limit(50).toArray();
            const chunks = rows.map((row, index) => ({
                text: row.text || '',
                label: row.label || 'document',
                keywords: row.keywords || 'N/A',
                chunkIndex: row.chunkIndex ?? index,
                fileName: row.fileName || 'N/A',
                uploadedAt: row.uploadedAt || 'N/A',
            }));

            return res.status(200).json({
                success: true,
                count: chunks.length,
                chunks,
            });
        } catch (error) {
            console.error('DB chunks route error:', error);
            return res.status(500).json({ message: 'Failed to fetch chunks.' });
        }
    });

    return router;
};
