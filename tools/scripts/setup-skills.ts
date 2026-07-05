import {
  mkdirSync,
  readdirSync,
  existsSync,
  readlinkSync,
  symlinkSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";

console.log("🛠️ Starting AI Skills Initialization...\n");

const AGENTS_SKILLS_DIR = ".agents/skills";
const CLAUDE_SKILLS_DIR = ".claude/skills";

// 1. Ensure SSOT directory exists
if (!existsSync(AGENTS_SKILLS_DIR)) {
  console.log(`[+] Creating ${AGENTS_SKILLS_DIR} ...`);
  mkdirSync(AGENTS_SKILLS_DIR, { recursive: true });
} else {
  console.log(`[v] Found ${AGENTS_SKILLS_DIR} (Single Source of Truth)`);
}

// 2. Ensure Claude directory exists
if (!existsSync(CLAUDE_SKILLS_DIR)) {
  console.log(`[+] Creating ${CLAUDE_SKILLS_DIR} ...`);
  mkdirSync(CLAUDE_SKILLS_DIR, { recursive: true });
}

// 3. Symlink skills from .agents to .claude
const skills = readdirSync(AGENTS_SKILLS_DIR, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);

if (skills.length === 0) {
  console.log(`[!] No skills found in ${AGENTS_SKILLS_DIR}. Skipping symlink generation.`);
} else {
  for (const skill of skills) {
    const targetPath = join(CLAUDE_SKILLS_DIR, skill);
    const linkSource = `../../${AGENTS_SKILLS_DIR}/${skill}`;

    if (existsSync(targetPath)) {
      try {
        const currentLink = readlinkSync(targetPath);
        if (currentLink === linkSource) {
          console.log(`[v] Symlink already exists for ${skill}`);
          continue;
        }
      } catch (err) {
        // Not a symlink, so delete it and recreate
      }
      // Remove old directory or incorrect symlink
      rmSync(targetPath, { recursive: true, force: true });
    }

    console.log(`[+] Creating symlink for ${skill} -> ${linkSource}`);
    symlinkSync(linkSource, targetPath, "dir");
  }
}

// 4. Generate Global Rules for Cursor and Cline
const globalRulesContent = `# Project Skills and Rules

This repository uses a Single Source of Truth (SSOT) for agent skills to maintain consistency across different AI tools (Cursor, Cline, Claude Code, Antigravity, etc.).

Please refer to the skills directory for specific instructions based on the task you are performing:
${skills.length > 0 ? skills.map((skill) => `- **${skill}**: ${AGENTS_SKILLS_DIR}/${skill}/SKILL.md`).join("\n") : "- (No skills configured yet)"}

Always read the relevant \`SKILL.md\` before proceeding with modifications to those components.
`;

console.log(`[+] Generating .cursorrules ...`);
writeFileSync(".cursorrules", globalRulesContent, "utf-8");

console.log(`[+] Generating .clinerules ...`);
writeFileSync(".clinerules", globalRulesContent, "utf-8");

console.log("\n✅ AI Skills Setup Complete!");
