const fs = require('fs');
const path = require('path');
const { Pinecone } = require('@pinecone-database/pinecone');
require('dotenv').config();

// Ensure required environment variables are present
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const indexName = process.env.PINECONE_INDEX_NAME || 'ask-vjk';

// Model config: gemini-embedding-2 is the flagship embedding model supporting MRL dimensionality controls
const EMBEDDING_MODEL = 'models/gemini-embedding-2';
const VECTOR_DIMENSION = 768;

if (!PINECONE_API_KEY) {
  console.error("Error: PINECONE_API_KEY is not set in the environment.");
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY is not set in the environment.");
  process.exit(1);
}

// Function to call Gemini API for embedding
async function getGeminiEmbedding(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      content: {
        parts: [{ text }]
      },
      outputDimensionality: VECTOR_DIMENSION
    })
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API returned status ${response.status}: ${errorText}`);
  }
  
  const data = await response.json();
  if (!data.embedding || !data.embedding.values) {
    throw new Error(`Embedding values not found in response: ${JSON.stringify(data)}`);
  }
  
  return data.embedding.values;
}

// Function to load profile.json and segment it into logical text chunks
function loadAndChunkData() {
  const dataPath = path.join(__dirname, '../data/profile.json');
  if (!fs.existsSync(dataPath)) {
    throw new Error(`profile.json not found at: ${dataPath}`);
  }
  
  console.log('Loading profile.json...');
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const chunks = [];
  
  // 1. Personal Info
  if (data.personal) {
    chunks.push({
      id: 'personal_info',
      text: `Personal Details of ${data.personal.fullName}:
Title: ${data.personal.title}
Nationality: ${data.personal.nationality}
Languages: ${data.personal.languages ? data.personal.languages.join(', ') : 'N/A'}`,
      metadata: { section: 'personal', type: 'info' }
    });
  }
  
  // 2. Contact Info
  if (data.contact) {
    chunks.push({
      id: 'contact_info',
      text: `Contact Details of Vihanga Kulathilake:
Email: ${data.contact.email}
Phone: ${data.contact.phone}
Address: ${data.contact.address}
Portfolio: ${data.contact.portfolio}
LinkedIn: ${data.contact.linkedin}
GitHub: ${data.contact.github}`,
      metadata: { section: 'contact', type: 'info' }
    });
  }
  
  // 3. Education
  if (data.education) {
    if (data.education.university) {
      const uni = data.education.university;
      chunks.push({
        id: 'education_university',
        text: `University Education of Vihanga Kulathilake:
University: ${uni.name}
Degree: ${uni.degree}
GPA: ${uni.gpa}
Period: ${uni.period}
Domains: ${uni.domains ? uni.domains.join(', ') : 'N/A'}`,
        metadata: { section: 'education', type: 'university' }
      });
    }
    if (data.education.school) {
      const school = data.education.school;
      chunks.push({
        id: 'education_school',
        text: `School Education of Vihanga Kulathilake:
School: ${school.name}
Location: ${school.location}
Period: ${school.period}
A/L Results: ${school.alResults}
Stream: ${school.stream}
Z-Score: ${school.zScore}`,
        metadata: { section: 'education', type: 'school' }
      });
    }
  }
  
  // 4. Experience
  if (Array.isArray(data.experience)) {
    data.experience.forEach((exp, idx) => {
      chunks.push({
        id: `experience_${idx}`,
        text: `Work Experience of Vihanga Kulathilake:
Organization: ${exp.organization}
Position: ${exp.position}
Period: ${exp.period}`,
        metadata: { section: 'experience', index: idx, organization: exp.organization }
      });
    });
  }
  
  // 5. Projects
  if (Array.isArray(data.projects)) {
    data.projects.forEach((proj, idx) => {
      chunks.push({
        id: `project_${idx}`,
        text: `Project - ${proj.name} by Vihanga Kulathilake:
Type: ${proj.type || 'N/A'}
Status: ${proj.status || 'Completed'}
Description: ${proj.description}
Technologies: ${proj.technologies ? proj.technologies.join(', ') : 'None'}`,
        metadata: { section: 'projects', index: idx, name: proj.name }
      });
    });
  }
  
  // 6. Skills
  if (data.skills) {
    const skills = data.skills;
    if (skills.programmingLanguages) {
      chunks.push({
        id: 'skills_languages',
        text: `Programming Languages of Vihanga Kulathilake:
Languages: ${skills.programmingLanguages.join(', ')}`,
        metadata: { section: 'skills', type: 'languages' }
      });
    }
    if (skills.frameworks) {
      chunks.push({
        id: 'skills_frameworks',
        text: `Frameworks & Libraries of Vihanga Kulathilake:
Frameworks: ${skills.frameworks.join(', ')}`,
        metadata: { section: 'skills', type: 'frameworks' }
      });
    }
    if (skills.databases) {
      chunks.push({
        id: 'skills_databases',
        text: `Databases & Storage of Vihanga Kulathilake:
Databases: ${skills.databases.join(', ')}`,
        metadata: { section: 'skills', type: 'databases' }
      });
    }
    if (skills.cloud || skills.tools) {
      chunks.push({
        id: 'skills_cloud_tools',
        text: `Cloud Services & Tools used by Vihanga Kulathilake:
Cloud: ${skills.cloud ? skills.cloud.join(', ') : 'None'}
Tools: ${skills.tools ? skills.tools.join(', ') : 'None'}`,
        metadata: { section: 'skills', type: 'cloud_tools' }
      });
    }
  }
  
  // 7. Core Competencies
  if (Array.isArray(data.coreCompetencies)) {
    chunks.push({
      id: 'core_competencies',
      text: `Core Competencies of Vihanga Kulathilake:
Competencies: ${data.coreCompetencies.join(', ')}`,
      metadata: { section: 'coreCompetencies' }
    });
  }
  
  // 8. Achievements
  if (Array.isArray(data.achievements)) {
    data.achievements.forEach((ach, idx) => {
      chunks.push({
        id: `achievement_${idx}`,
        text: `Achievement of Vihanga Kulathilake:
Title: ${ach.title}
Result: ${ach.result}`,
        metadata: { section: 'achievements', index: idx }
      });
    });
  }
  
  // 9. Leadership
  if (Array.isArray(data.leadership)) {
    data.leadership.forEach((lead, idx) => {
      chunks.push({
        id: `leadership_${idx}`,
        text: `Leadership & Volunteering of Vihanga Kulathilake:
Organization: ${lead.organization}
Role: ${lead.role}
Period: ${lead.period}`,
        metadata: { section: 'leadership', index: idx, organization: lead.organization }
      });
    });
  }
  
  console.log(`Divided profile data into ${chunks.length} chunks.`);
  return chunks;
}

async function main() {
  try {
    const chunks = loadAndChunkData();
    
    console.log('Connecting to Pinecone...');
    const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
    
    // Check if index exists
    console.log('Retrieving Pinecone indexes list...');
    const indexList = await pc.listIndexes();
    const indexExists = indexList.indexes?.some(idx => idx.name === indexName);
    
    if (!indexExists) {
      console.log(`Index "${indexName}" does not exist. Attempting to create it...`);
      try {
        await pc.createIndex({
          name: indexName,
          dimension: VECTOR_DIMENSION, 
          metric: 'cosine',
          spec: {
            serverless: {
              cloud: 'aws',
              region: 'us-east-1'
            }
          }
        });
        
        console.log(`Index creation for "${indexName}" initiated. Waiting for it to become ready...`);
        let isReady = false;
        while (!isReady) {
          const desc = await pc.describeIndex(indexName);
          if (desc.status?.ready) {
            isReady = true;
            console.log(`Index "${indexName}" is now ready!`);
          } else {
            console.log('Index is still initializing, waiting 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      } catch (err) {
        console.error(`Error creating index: ${err.message}`);
        console.error(`Note: Pinecone free tier allows only one free index. If you already have one, please create an index named "${indexName}" manually, or set PINECONE_INDEX_NAME in your .env to an existing index.`);
        process.exit(1);
      }
    } else {
      console.log(`Index "${indexName}" already exists. Using it.`);
    }
    
    const index = pc.index(indexName);
    const records = [];
    
    console.log('\nGenerating embeddings using Gemini API (gemini-embedding-2)...');
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[${i + 1}/${chunks.length}] Generating embedding for: ${chunk.id}...`);
      try {
        const values = await getGeminiEmbedding(chunk.text);
        records.push({
          id: chunk.id,
          values,
          metadata: {
            text: chunk.text,
            ...chunk.metadata
          }
        });
        // Tiny pause to avoid aggressive rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`Failed to generate embedding for chunk "${chunk.id}": ${err.message}`);
        throw err;
      }
    }
    
    console.log(`\nUpserting ${records.length} records to Pinecone index "${indexName}"...`);
    // Upsert in batches of 10 to be safe and clean
    const batchSize = 10;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      console.log(`Upserting batch ${Math.floor(i / batchSize) + 1} (${batch.length} records)...`);
      await index.upsert({ records: batch });
    }
    
    console.log('\nSuccessfully chunked, embedded, and stored all profile data in Pinecone database!');
  } catch (error) {
    console.error('\nAn error occurred during execution:', error);
    process.exit(1);
  }
}

main();
