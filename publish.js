const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Authentication tokens - PLACEHOLDER
// You need to configure your own tokens in ~/.clasprc.json
// See Google Apps Script clasp documentation for authentication setup
const tokens = null;

// Path to store clasp credentials
const CLASPRC_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.clasprc.json');

/**
 * Check if authentication tokens exist
 */
function checkTokens() {
  try {
    if (fs.existsSync(CLASPRC_PATH)) {
      const tokenData = JSON.parse(fs.readFileSync(CLASPRC_PATH, 'utf8'));
      return tokenData && tokenData.tokens && tokenData.tokens.default;
    }
    return false;
  } catch (error) {
    console.error('Error checking tokens:', error.message);
    return false;
  }
}

/**
 * Execute a clasp command
 * @param {string} command - The clasp command to execute
 * @param {string[]} args - Arguments for the command
 * @returns {Promise<string>} - Promise that resolves with the command output
 */
function executeClaspCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const claspArgs = [command, ...args];
    console.log(`Executing: npx @google/clasp ${claspArgs.join(' ')}`);
    
    const childProcess = spawn('npx', ['@google/clasp', ...claspArgs], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    childProcess.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Push code to Google Apps Script project
 */
async function pushCode() {
  try {
    console.log('Pushing code to Google Apps Script...');
    const result = await executeClaspCommand('push');
    console.log('Code pushed successfully!');
    return result;
  } catch (error) {
    console.error('Error pushing code:', error.message);
    throw error;
  }
}

/**
 * Deploy the project
 */
async function deployProject() {
  try {
    console.log('Deploying project...');
    
    // First, create a new version
    const versionResult = await executeClaspCommand('version', ['-d', 'Deployment via publish script']);
    console.log('Version created successfully!');
    
    // Then, deploy the latest version
    const deployResult = await executeClaspCommand('deploy', ['-d', 'Latest deployment', '-i', '1']);
    console.log('Project deployed successfully!');
    
    return { versionResult, deployResult };
  } catch (error) {
    console.error('Error deploying project:', error.message);
    throw error;
  }
}

/**
 * Check if logged in to clasp
 */
async function checkLoginStatus() {
  try {
    // Check if .clasp.json exists which indicates a linked project
    const claspConfigPath = path.join(__dirname, '.clasp.json');
    if (!fs.existsSync(claspConfigPath)) {
      console.log('No .clasp.json file found. Project may not be initialized.');
      return false;
    }
    
    // Check if authentication tokens exist
    if (!checkTokens()) {
      console.log('Authentication tokens not found. Please run "clasp login" first.');
      return false;
    }
    
    // Since we have both .clasp.json and tokens, we assume the project is set up
    return true;
  } catch (error) {
    // If there's an error checking the files, return false
    return false;
  }
}

/**
 * Main function to handle publishing
 */
async function main() {
  console.log('VK Auction Bot Publisher');
  console.log('========================');
  
  try {
    // Check if already logged in
    const isLoggedIn = await checkLoginStatus();
    
    if (!isLoggedIn) {
      console.log('Authentication not configured. Please run "clasp login" first.');
      console.log('See Google Apps Script clasp documentation for authentication setup.');
      return;
    } else {
      console.log('Already authenticated with clasp.');
    }
    
    // Parse command line arguments
    const args = process.argv.slice(2);
    
    if (args.includes('--push') || args.includes('-p')) {
      await pushCode();
    } else if (args.includes('--deploy') || args.includes('-d')) {
      await deployProject();
    } else if (args.includes('--full') || args.includes('-f')) {
      await pushCode();
      await deployProject();
    } else {
      // Default: show help
      console.log('\nUsage:');
      console.log('  node publish.js --push    (-p)  Push code to Apps Script');
      console.log('  node publish.js --deploy  (-d)  Deploy the project');
      console.log('  node publish.js --full    (-f)  Push and deploy in one command');
      console.log('');
    }
  } catch (error) {
    console.error('\nPublishing failed:', error.message);
    process.exit(1);
  }
}

// Run the main function if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = {
  pushCode,
  deployProject,
  executeClaspCommand,
  checkLoginStatus
};