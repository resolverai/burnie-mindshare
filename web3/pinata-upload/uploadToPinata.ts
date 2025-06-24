import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

interface UploadResult {
  id: string;
  name: string;
  cid: string;
  size: number;
  number_of_files: number;
  mime_type: string;
  group_id: string | null;
}

async function uploadStringToPinata(content: string, filename: string = "text.txt"): Promise<string> {
  try {
    // Validate environment variables
    const pinataJwt = process.env.PINATA_JWT_SECRET;
    if (!pinataJwt) {
      throw new Error("PINATA_JWT_SECRET environment variable is required");
    }

    // Create a File object from the string content
    const file = new File([content], filename, { type: "text/plain" });

    console.log(`Uploading "${filename}" to Pinata IPFS...`);
    console.log(`Content length: ${content.length} characters`);

    // Create FormData
    const formData = new FormData();
    formData.append("file", file);
    formData.append("network", "public");

    // Make the API request
    const request = await fetch("https://uploads.pinata.cloud/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pinataJwt}`,
      },
      body: formData,
    });

    if (!request.ok) {
      const errorText = await request.text();
      throw new Error(`Upload failed with status ${request.status}: ${errorText}`);
    }

    const response = await request.json() as any;
    const upload = response.data; // The actual data is nested under 'data'
    
    // Debug: Log the actual response structure
    console.log("Raw API Response:", JSON.stringify(response, null, 2));

    console.log("Upload successful!");
    console.log(`File ID: ${upload.id}`);
    console.log(`File Name: ${upload.name}`);
    console.log(`CID: ${upload.cid}`);
    console.log(`Size: ${upload.size} bytes`);
    console.log(`MIME Type: ${upload.mime_type}`);

    return upload.cid;
  } catch (error) {
    console.error("Error uploading to Pinata:", error);
    throw error;
  }
}

async function main() {
  // Get the string content from command line arguments
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: ts-node uploadToPinata.ts <content> [filename]");
    console.error("Example: ts-node uploadToPinata.ts 'Hello World!' myfile.txt");
    process.exit(1);
  }

  const content = args[0];
  const filename = args[1] || "text.txt";

  try {
    const cid = await uploadStringToPinata(content, filename);
    console.log(`\n✅ Upload completed! CID: ${cid}`);
    console.log(`🔗 IPFS Gateway URL: https://gateway.pinata.cloud/ipfs/${cid}`);
    console.log(`🔗 Pinata Gateway URL: https://gateway.pinata.cloud/ipfs/${cid}`);
    
    // Exit with success
    process.exit(0);
  } catch (error) {
    console.error("❌ Upload failed:", error);
    process.exit(1);
  }
}

// Export the function for use in other modules
export { uploadStringToPinata };

// Run the script if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Script execution failed:", error);
    process.exit(1);
  });
} 