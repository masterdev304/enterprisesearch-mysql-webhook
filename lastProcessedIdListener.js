const mysql = require("mysql2/promise");
const client = require("./elasticsearch");
const fs = require("fs"); // To read the SSL certificate file
const axios = require("axios");
const processFieldContent = require("./mysqlwebhookServices.js").processFieldContent;
require("dotenv").config();

exports.lastProcessedIdListener = async () => {
    try {
        console.log("Starting MySQL Last Processed ID Monitor...");

        // Step 1: Get all indices with the prefix "datasource_mysql_connection_"
        const indicesResponse = await client.cat.indices({ format: "json" });
        const indices = indicesResponse
            .map((index) => index.index)
            .filter((name) => name.startsWith("datasource_mysql_connection_"));

        console.log("Found indices: ", indices);

        for (const index of indices) {
            // Step 2: Query ElasticSearch for database configuration
            const query = {
                query: {
                    match_all: {},
                },
            };

            const result = await client.search({
                index,
                body: query,
            });

            for (const configDoc of result.hits.hits) {
                const {
                    host,
                    user,
                    password,
                    database,
                    table_name,
                    field_name,
                    field_type,
                    category,
                    coid,
                    lastProcessedId,
                } = configDoc._source;

                console.log(
                    `Processing table: ${table_name} in database: ${database} at host: ${host}`
                );

                // Step 3: Create a MySQL connection
                const connection = await mysql.createConnection({
                    host: host,
                    user: user,
                    password: password,
                    database: database,
                    ssl: {
                        ca: fs.readFileSync("./DigiCertGlobalRootCA.crt.pem"), // Replace with the actual path to the certificate
                    },
                });

                // Step 4: Fetch new rows from the table based on the last processed ID
                const [rows] = await connection.query(
                    `SELECT id, ${field_name} AS field_value FROM ${table_name} WHERE id > ? ORDER BY id ASC`,
                    [lastProcessedId || 0]
                );

                console.log("New rows fetched: ", rows);

                if (rows.length > 0) {
                    console.log(`New rows detected:`, rows);

                    const documents = [];

                    for (const row of rows) {
                        try {
                            const content = await processFieldContent(row.field_value, field_type);

                            if (content) {
                                // Prepare the document structure
                                documents.push({
                                    "@search.action": "mergeOrUpload",
                                    id: row.id.toString(),
                                    title: `Default Title for Row ${row.id}`, // Default or provided
                                    content, // Processed content
                                    description: `Default Description for Row ${row.id}`, // Default or provided
                                    image: null, // Optional
                                    category: category, // Default or provided
                                });
                            }
                        } catch (error) {
                            console.error(`Error processing content for row ID ${row.RowID}:`, error.message);
                        }
                    }

                    if (documents.length > 0) {
                        const indexName = `tenant_${coid.toLowerCase()}`;

                        const payload = {
                            value: documents,
                        };

                        // Push data to Azure Search (uncomment if necessary)
                        const esResponse = await axios.post(
                            `${process.env.AZURE_SEARCH_ENDPOINT}/indexes/${indexName}/docs/index?api-version=2021-04-30-Preview`,
                            payload,
                            {
                                headers: {
                                    "Content-Type": "application/json",
                                    "api-key": process.env.AZURE_SEARCH_API_KEY,
                                },
                            }
                        );

                        console.log("ES Response Data => ", esResponse.data);

                        console.log(
                            `Documents pushed successfully to Azure Search in index: ${indexName}`
                        );
                    } else {
                        console.log("No documents to index.");
                    }

                    // Step 5: Update the last processed ID in ElasticSearch
                    const newLastProcessedId = rows[rows.length - 1].id;

                    await client.update({
                        index,
                        id: configDoc._id,
                        body: {
                            doc: {
                                lastProcessedId: newLastProcessedId,
                                updatedAt: new Date().toISOString(),
                            },
                        },
                    });

                    console.log(
                        `Last processed ID updated to: ${newLastProcessedId}`
                    );
                } else {
                    console.log(`No new rows detected for table: ${table_name}`);
                }

                // Close MySQL connection
                await connection.end();
            }
        }
    } catch (error) {
        console.error(
            "Error in MySQL Last Processed ID Monitor:",
            error.message
        );
    }
};
