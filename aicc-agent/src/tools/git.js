'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const PROJECT_ROOT = process.env.PROJECT_ROOT || '/var/www/interviewpro-v2';

// Branches that are never allowed as commit/push targets
const PROTECTED_BRANCHES = ['main', 'master', 'production', 'prod'];

/**
 * Run a git command in the project root.
 */
async function runGit(args, cwd = PROJECT_ROOT) {
  const { stdout, stderr } = await execAsync(`git ${args}`, {
    cwd,
    timeout: 30000,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Get the current branch name.
 */
async function getCurrentBranch() {
  const { stdout } = await runGit('rev-parse --abbrev-ref HEAD');
  return stdout;
}

/**
 * git_ops tool — safe git operations.
 * @param {{ action: string, branch?: string, message?: string }} params
 * @returns {Promise<string>}
 */
async function gitOps({ action, branch, message }) {
  if (!action) {
    return 'Error: action parameter is required (branch|commit|push|status|diff)';
  }

  try {
    switch (action) {
      case 'status': {
        const { stdout } = await runGit('status --short');
        const branch_ = await getCurrentBranch();
        return `Branch: ${branch_}\n\nStatus:\n${stdout || '(clean)'}`;
      }

      case 'diff': {
        const { stdout } = await runGit('diff --stat HEAD');
        const fullDiff = await runGit('diff HEAD -- . ":(exclude)*.lock"');
        return `Diff stat:\n${stdout || '(no changes)'}\n\nFull diff:\n${fullDiff.stdout || '(no changes)'}`;
      }

      case 'branch': {
        if (!branch) {
          return 'Error: branch parameter is required for action=branch';
        }
        // Ensure it starts with feature/ or fix/ or chore/
        const safeBranchName = branch.startsWith('feature/')
          || branch.startsWith('fix/')
          || branch.startsWith('chore/')
          || branch.startsWith('aicc/')
          ? branch
          : `feature/${branch}`;

        if (PROTECTED_BRANCHES.includes(safeBranchName)) {
          return `BLOCKED: Cannot create branch with protected name "${safeBranchName}"`;
        }

        try {
          // Try to switch to existing branch first
          const { stdout } = await runGit(`checkout ${safeBranchName}`);
          return `Switched to existing branch: ${safeBranchName}\n${stdout}`;
        } catch (_) {
          // Create new branch
          const { stdout } = await runGit(`checkout -b ${safeBranchName}`);
          return `Created and switched to new branch: ${safeBranchName}\n${stdout}`;
        }
      }

      case 'commit': {
        if (!message) {
          return 'Error: message parameter is required for action=commit';
        }

        const currentBranch = await getCurrentBranch();
        if (PROTECTED_BRANCHES.includes(currentBranch)) {
          return `BLOCKED: Cannot commit directly to protected branch "${currentBranch}". Create a feature branch first using action=branch.`;
        }

        // Stage all changes
        await runGit('add -A');

        // Check if there's anything to commit
        const { stdout: statusOut } = await runGit('status --short');
        if (!statusOut && !statusOut.trim()) {
          // Nothing staged — check again
        }

        const { stdout } = await runGit(`commit -m "${message.replace(/"/g, '\\"')}"`);
        return `Committed on branch ${currentBranch}:\n${stdout}`;
      }

      case 'push': {
        const currentBranch = await getCurrentBranch();
        if (PROTECTED_BRANCHES.includes(currentBranch)) {
          return `BLOCKED: Cannot push to protected branch "${currentBranch}". Switch to a feature branch first.`;
        }

        const { stdout } = await runGit(`push origin ${currentBranch} --set-upstream`);
        return `Pushed branch ${currentBranch} to origin:\n${stdout}`;
      }

      case 'log': {
        const { stdout } = await runGit('log --oneline -10');
        return `Recent commits:\n${stdout || '(no commits)'}`;
      }

      default:
        return `Error: Unknown action "${action}". Valid actions: branch, commit, push, status, diff, log`;
    }
  } catch (err) {
    return `Git error (action=${action}): ${err.message}\n${err.stderr || ''}`.trim();
  }
}

module.exports = { gitOps };
