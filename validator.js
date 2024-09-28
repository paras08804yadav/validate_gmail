const express = require('express');
const dns = require('dns');
const net = require('net');

const app = express();
const PORT = 3000;

app.use(express.json());

const fromEmail = 'rachnay888@gmail.com'; // Your from email address

function log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${message}`);
}

function getMxRecord(domain) {
    return new Promise((resolve, reject) => {
        dns.resolveMx(domain, (err, addresses) => {
            if (err || !addresses.length) {
                reject(`Failed to get MX record for domain '${domain}': ${err}`);
            } else {
                resolve(addresses[0]); // Return the first MX record
            }
        });
    });
}

async function smtpCheck(email, mxRecord) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection(25, mxRecord.exchange, () => {
            log(`Connected to SMTP server: ${mxRecord.exchange}`);
            client.write(`HELO gmail.com\r\n`);
        });

        let mailFromResponseReceived = false;
        let rcptResponseReceived = false;

        // Timeout handling
        const timeout = setTimeout(() => {
            log(`Connection to ${mxRecord.exchange} timed out.`);
            client.destroy(); // Close the connection
            reject(new Error('Connection timed out'));
        }, 5000); // 5 seconds timeout

        client.on('data', (data) => {
            clearTimeout(timeout); // Clear timeout on response
            const response = data.toString();
            log(`SMTP Response: ${response}`); // Log SMTP response

            if (response.includes('250')) {  // Check if response includes '250'
                if (!mailFromResponseReceived) {
                    mailFromResponseReceived = true;
                    log(`Sending MAIL FROM command for: ${fromEmail}`);
                    client.write(`MAIL FROM:<${fromEmail}>\r\n`);
                } else if (!rcptResponseReceived) {
                    rcptResponseReceived = true;
                    log(`Sending RCPT TO command for: ${email}`);
                    client.write(`RCPT TO:<${email}>\r\n`);
                } else {
                    resolve(true); // Valid email
                    log(`Email is valid: ${email}`);
                    client.end();
                }
            } else if (response.startsWith('550') && rcptResponseReceived) {
                log(`Email is invalid: ${email}`);
                resolve(false); // Invalid email
                client.end();
            }
        });

        client.on('error', (error) => {
            log(`Error during SMTP validation: ${error}`);
            resolve(false); // Assume invalid if an error occurs
            client.end();
        });

        client.on('end', () => {
            log('Connection closed');
        });
    });
}


function syntaxCheck(email) {
    return /\S+@\S+\.\S+/.test(email);
}

app.post('/verify-emails', async (req, res) => {
    const emailString = req.body.emails; // Get emails as a comma-separated string
    const emailList = emailString.split(',').map(email => email.trim()); // Convert to array and trim spaces

    const results = {
        validEmails: [],
        invalidEmails: [],
    };

    for (const email of emailList) {
        if (email.endsWith("@gmail.com") && syntaxCheck(email)) {
            const domain = email.split('@')[1];
            try {
                const mxRecord = await getMxRecord(domain);
                log(`Retrieved MX record for domain ${domain}: ${JSON.stringify(mxRecord)}`);
                const isValid = await smtpCheck(email, mxRecord);
                if (isValid) {
                    results.validEmails.push(email); // Save valid email
                } else {
                    results.invalidEmails.push(email); // Save invalid email
                }
            } catch (error) {
                log(`Error verifying email ${email}: ${error}`);
                results.invalidEmails.push(email); // Handle error as invalid
            }
        } else {
            log(`Invalid email syntax or non-Gmail address: ${email}`);
            results.invalidEmails.push(email); // Invalid syntax or not a Gmail address
        }
    }

    res.json(results); // Respond with valid and invalid emails
});
;

app.listen(PORT, () => {
    log(`Server is running on http://localhost:${PORT}`);
});
