#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CLUSTER_DIR = './cluster_json';
const MANIFEST_PATH = path.join(CLUSTER_DIR, 'manifest.json');

function extractClusterNumber(filename) {
  // Extract cluster number like c30, c152 from filename
  const match = filename.match(/_c(\d+)\.json$/);
  return match ? parseInt(match[1]) : null;
}

function filenameToLabel(filename) {
  // Remove .json extension only
  let label = filename.replace(/\.json$/, '');

  // Replace underscores with spaces
  label = label.replace(/_/g, ' ');

  // Capitalize each word
  label = label.split(' ').map(word => {
    if (word.length === 0) return word;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');

  return label;
}

async function generateManifest() {
  console.log('Reading cluster files from:', CLUSTER_DIR);

  // Read all files in cluster_json directory
  const files = fs.readdirSync(CLUSTER_DIR)
    .filter(file => file.endsWith('.json') && file !== 'manifest.json');

  console.log(`Found ${files.length} cluster files`);

  const clusters = [];
  const tokenIndex = {}; // token -> Set of cluster IDs

  for (const file of files) {
    const clusterNum = extractClusterNumber(file);
    if (clusterNum === null) {
      console.warn(`Warning: Could not extract cluster number from ${file}, skipping`);
      continue;
    }

    // Get ID without .json extension
    const id = file.replace(/\.json$/, '');

    // Try to read the file to get its meta.title from GRAPH_V1 format
    let labelFromFile = null;
    try {
      const filePath = path.join(CLUSTER_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      // Get label from GRAPH_V1 meta.title
      labelFromFile = data.meta?.title;

      // Clean up the label if found
      if (labelFromFile) {
        labelFromFile = labelFromFile
          .trim()
          .replace(/^\[?\[?(.+?)\]?\]?$/, '$1')
          .replace(/^\[.*?:\s*/, '')
          .trim();
      }

      // Extract tokens for search index
      extractTokensFromCluster(data, id, tokenIndex);

    } catch (err) {
      console.warn(`Warning: Could not read ${file}:`, err.message);
    }

    // Use meta.title from file, or fallback to filename-based label
    const baseLabel = labelFromFile || filenameToLabel(file);
    // Don't add cluster number prefix - use label as-is
    const label = baseLabel;

    clusters.push({
      id: id,
      label: label,
      clusterNum: clusterNum  // For sorting
    });
  }
  
  // Sort by cluster number
  clusters.sort((a, b) => a.clusterNum - b.clusterNum);
  
  // Remove clusterNum field from final output (it was just for sorting)
  const finalClusters = clusters.map(({ id, label }) => ({ id, label }));
  
  // Create manifest object
  const manifest = {
    clusters: finalClusters
  };
  
  // Write manifest.json
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');

  console.log(`\n✅ Generated manifest.json with ${finalClusters.length} clusters`);
  console.log(`   Saved to: ${MANIFEST_PATH}`);
  console.log(`\nFirst few entries:`);
  finalClusters.slice(0, 5).forEach(c => {
    console.log(`  - ${c.label}`);
  });
  console.log('  ...');

  // Generate token index for cross-cluster search
  await generateTokenIndex(tokenIndex);
}

function extractTokensFromCluster(data, clusterId, tokenIndex) {
  if (!data) return;

  // Handle GRAPH_V1 format
  if (data.nodes && Array.isArray(data.nodes)) {
    data.nodes.forEach(node => {
      if (node.token) {
        const token = node.token.toLowerCase().trim();
        if (token && token.length > 0) {
          if (!tokenIndex[token]) {
            tokenIndex[token] = new Set();
          }
          tokenIndex[token].add(clusterId);
        }
      }
    });
  }
  // Handle legacy bundle format
  else if (data.nodes_by_id) {
    Object.values(data.nodes_by_id).forEach(node => {
      if (node.token) {
        const token = node.token.toLowerCase().trim();
        if (token && token.length > 0) {
          if (!tokenIndex[token]) {
            tokenIndex[token] = new Set();
          }
          tokenIndex[token].add(clusterId);
        }
      }
    });
  }
}

async function generateTokenIndex(tokenIndex) {
  console.log('\n🔍 Generating token index for cross-cluster search...');

  // Convert Sets to Arrays and sort for consistent output
  const sortedTokenIndex = {};
  Object.keys(tokenIndex).sort().forEach(token => {
    sortedTokenIndex[token] = Array.from(tokenIndex[token]).sort();
  });

  const TOKEN_INDEX_PATH = path.join(CLUSTER_DIR, 'token_index.json');
  fs.writeFileSync(TOKEN_INDEX_PATH, JSON.stringify(sortedTokenIndex, null, 2), 'utf-8');

  const totalTokens = Object.keys(sortedTokenIndex).length;
  const totalReferences = Object.values(sortedTokenIndex).reduce((sum, clusters) => sum + clusters.length, 0);

  console.log(`✅ Generated token_index.json`);
  console.log(`   Saved to: ${TOKEN_INDEX_PATH}`);
  console.log(`   Unique tokens: ${totalTokens.toLocaleString()}`);
  console.log(`   Total token-cluster references: ${totalReferences.toLocaleString()}`);

  // Show some examples
  const examples = Object.entries(sortedTokenIndex)
    .filter(([token, clusters]) => clusters.length > 1) // Only show tokens in multiple clusters
    .slice(0, 5);

  if (examples.length > 0) {
    console.log(`\nExample cross-cluster tokens:`);
    examples.forEach(([token, clusters]) => {
      console.log(`  - "${token}" → ${clusters.length} clusters: ${clusters.slice(0, 3).join(', ')}${clusters.length > 3 ? '...' : ''}`);
    });
  }
}

// Run the script
generateManifest().catch(err => {
  console.error('Error generating manifest:', err);
  process.exit(1);
});
