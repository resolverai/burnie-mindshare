# Pinata IPFS Upload Script

A standalone TypeScript script to upload strings to Pinata IPFS as text files using the Pinata API directly.

## Features

- 📤 Upload any string content to IPFS via Pinata API
- 🔧 Standalone TypeScript script (no SDK dependency)
- 📝 Customizable filename
- 🔗 Returns CID and gateway URLs
- ⚡ Easy to use with ts-node
- 🚀 Lightweight (uses native fetch API)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your Pinata credentials
   ```

3. **Required environment variables:**
   - `PINATA_JWT_SECRET` - Your Pinata JWT token (required)

## Usage

### Basic Usage
```bash
ts-node uploadToPinata.ts "Hello World!"
```

### With Custom Filename
```bash
ts-node uploadToPinata.ts "Hello World!" myfile.txt
```

### Using npm script
```bash
npm start "Hello World!" myfile.txt
```

## Example Output
```
Uploading "myfile.txt" to Pinata IPFS...
Content length: 11 characters
Upload successful!
File ID: 349f1bb2-5d59-4cab-9966-e94c028a05b7
File Name: myfile.txt
CID: bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra
Size: 11 bytes
MIME Type: text/plain

✅ Upload completed! CID: bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra
🔗 IPFS Gateway URL: https://gateway.pinata.cloud/ipfs/bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra
🔗 Pinata Gateway URL: https://gateway.pinata.cloud/ipfs/bafybeihgxdzljxb26q6nf3r3eifqeedsvt2eubqtskghpme66cgjyw4fra
```

## Programmatic Usage

You can also import and use the function in other TypeScript files:

```typescript
import { uploadStringToPinata } from './uploadToPinata';

const cid = await uploadStringToPinata("Hello World!", "greeting.txt");
console.log(`Uploaded with CID: ${cid}`);
```

## API Method

This script uses the Pinata API directly with `fetch` and `FormData`:

```typescript
const formData = new FormData();
formData.append("file", file);
formData.append("network", "public");

const request = await fetch("https://uploads.pinata.cloud/v3/files", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${JWT}`,
  },
  body: formData,
});
```

## Getting Pinata Credentials

1. Sign up at [Pinata](https://app.pinata.cloud/)
2. Go to API Keys section
3. Create a new API key
4. Copy the JWT token to your `.env` file

## Dependencies

- `dotenv` - Environment variable management
- `ts-node` - TypeScript execution
- `typescript` - TypeScript compiler

## License

MIT 