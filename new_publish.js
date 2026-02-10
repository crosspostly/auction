const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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
    
    // Copy files from src to root temporarily for clasp push
    const srcDir = path.join(__dirname, 'src');
    const files = fs.readdirSync(srcDir);
    
    for (const file of files) {
      const srcFilePath = path.join(srcDir, file);
      const destFilePath = path.join(__dirname, file);  // Copy to root without src/
      
      if (fs.statSync(srcFilePath).isFile()) {
        fs.copyFileSync(srcFilePath, destFilePath);
        console.log(`Copied ${file} to root directory`);
      }
    }
    
    // Now push the files
    const result = await executeClaspCommand('push');
    console.log('Code pushed successfully!');
    
    // Clean up: remove copied files from root
    for (const file of files) {
      const destFilePath = path.join(__dirname, file);
      if (fs.existsSync(destFilePath) && (path.extname(destFilePath) === '.gs' || path.extname(destFilePath) === '.js' || path.extname(destFilePath) === '.html')) {
        fs.unlinkSync(destFilePath);
        console.log(`Removed ${file} from root directory`);
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error pushing code:', error.message);
    throw error;
  }
}

/**
 * Pull code from Google Apps Script project
 */
async function pullCode() {
  try {
    console.log('Pulling code from Google Apps Script...');
    const result = await executeClaspCommand('pull');
    
    // Move pulled files to src directory
    const files = fs.readdirSync(__dirname).filter(file => 
      path.extname(file) === '.gs' || path.extname(file) === '.js' || path.extname(file) === '.html'
    );
    
    const srcDir = path.join(__dirname, 'src');
    if (!fs.existsSync(srcDir)) {
      fs.mkdirSync(srcDir, { recursive: true });
    }
    
    for (const file of files) {
      if (file !== 'appsscript.json' && file !== 'new_publish.js' && file !== 'publish.js') {
        const srcFilePath = path.join(__dirname, file);
        const destFilePath = path.join(srcDir, file);
        
        fs.renameSync(srcFilePath, destFilePath);
        console.log(`Moved ${file} to src directory`);
      }
    }
    
    console.log('Code pulled and organized successfully!');
    return result;
  } catch (error) {
    console.error('Error pulling code:', error.message);
    throw error;
  }
}

/**
 * Main function to handle publishing
 */
async function main() {
  console.log('VK Auction Bot Publisher (New)');
  console.log('=============================');

  try {
    // Parse command line arguments
    const args = process.argv.slice(2);

    if (args.includes('--push') || args.includes('-p')) {
      await pushCode();
    } else if (args.includes('--pull') || args.includes('-l')) {
      await pullCode();
    } else {
      // Default: show help
      console.log('\nUsage:');
      console.log('  node new_publish.js --push    (-p)  Push code to Apps Script (from src/)');
      console.log('  node new_publish.js --pull    (-l)  Pull code from Apps Script (to src/)');
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
  pullCode,
  executeClaspCommand
};