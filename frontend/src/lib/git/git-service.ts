import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { fileService } from "../file-system/file-service";

export interface GitStatus {
  filepath: string;
  head: 0 | 1;
  workdir: 0 | 1 | 2;
  stage: 0 | 1 | 2 | 3;
}

export interface GitLogEntry {
  oid: string;
  message: string;
  timestamp: number;
  author: {
    name: string;
    email: string;
  };
}

export class GitService {
  private authToken: string | null = null;
  private authorName: string = "ResearchOS User";
  private authorEmail: string = "user@researchos.local";

  setAuthToken(token: string): void {
    this.authToken = token;
  }

  getAuthToken(): string | null {
    return this.authToken;
  }

  clearAuthToken(): void {
    this.authToken = null;
  }

  setAuthor(name: string, email: string): void {
    this.authorName = name;
    this.authorEmail = email;
  }

  private getFs() {
    return {
      promises: {
        readFile: async (filepath: string, options?: { encoding?: string }) => {
          const handle = fileService.getDirectoryHandle();
          if (!handle) throw new Error("No directory handle");

          const content = await this.readFileFromHandle(handle, filepath);
          if (options?.encoding === "utf8" || options?.encoding === "utf-8") {
            return content.toString("utf-8");
          }
          return content;
        },

        writeFile: async (filepath: string, data: string | Buffer, options?: { encoding?: string }) => {
          const handle = fileService.getDirectoryHandle();
          if (!handle) throw new Error("No directory handle");

          await this.writeFileToHandle(handle, filepath, Buffer.isBuffer(data) ? data : Buffer.from(data));
        },

        mkdir: async (filepath: string) => {
          await fileService.ensureDir(filepath);
        },

        rmdir: async (filepath: string) => {
          const handle = fileService.getDirectoryHandle();
          if (!handle) return;

          const parts = filepath.split("/").filter(Boolean);
          let currentHandle = handle;

          for (let i = 0; i < parts.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
          }

          await currentHandle.removeEntry(parts[parts.length - 1], { recursive: true });
        },

        unlink: async (filepath: string) => {
          await fileService.deleteFile(filepath);
        },

        readdir: async (filepath: string) => {
          const handle = fileService.getDirectoryHandle();
          if (!handle) return [];

          const files = await fileService.listFiles(filepath);
          const dirs = await fileService.listDirectories(filepath);
          return [...files, ...dirs];
        },

        stat: async (filepath: string) => {
          const exists = await fileService.fileExists(filepath);
          if (!exists) throw new Error(`File not found: ${filepath}`);

          return {
            isFile: () => true,
            isDirectory: () => false,
            size: 0,
            mtime: new Date(),
            ctime: new Date(),
          };
        },

        lstat: async (filepath: string) => {
          const exists = await fileService.fileExists(filepath);
          if (!exists) throw new Error(`File not found: ${filepath}`);

          return {
            isFile: () => true,
            isDirectory: () => false,
            size: 0,
            mtime: new Date(),
            ctime: new Date(),
          };
        },

        readlink: async (filepath: string) => {
          return filepath;
        },

        symlink: async (target: string, filepath: string) => {
          throw new Error("Symlinks not supported");
        },
      },
    };
  }

  private async readFileFromHandle(
    handle: FileSystemDirectoryHandle,
    path: string
  ): Promise<Buffer> {
    const parts = path.split("/").filter(Boolean);
    let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = handle;

    for (let i = 0; i < parts.length - 1; i++) {
      currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(parts[i]);
    }

    const fileHandle = await (currentHandle as FileSystemDirectoryHandle).getFileHandle(parts[parts.length - 1]);
    const file = await fileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async writeFileToHandle(
    handle: FileSystemDirectoryHandle,
    path: string,
    data: Buffer
  ): Promise<void> {
    const parts = path.split("/").filter(Boolean);
    let currentHandle = handle;

    for (let i = 0; i < parts.length - 1; i++) {
      currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: true });
    }

    const fileHandle = await currentHandle.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Uint8Array(data));
    await writable.close();
  }

  async isRepo(): Promise<boolean> {
    const handle = fileService.getDirectoryHandle();
    if (!handle) return false;

    try {
      await handle.getDirectoryHandle(".git");
      return true;
    } catch {
      return false;
    }
  }

  async init(): Promise<void> {
    const fs = this.getFs();
    const dir = "/";

    await git.init({ fs, dir });
  }

  async clone(url: string): Promise<void> {
    if (!this.authToken) {
      throw new Error("Git authentication token required");
    }

    const fs = this.getFs();
    const dir = "/";

    await git.clone({
      fs,
      http,
      dir,
      url,
      onAuth: () => ({
        username: this.authToken!,
        password: "x-oauth-basic",
      }),
    });
  }

  async getStatus(): Promise<GitStatus[]> {
    const fs = this.getFs();
    const dir = "/";

    const status = await git.statusMatrix({ fs, dir });
    return status.map(([filepath, head, workdir, stage]) => ({
      filepath,
      head: head as 0 | 1,
      workdir: workdir as 0 | 1 | 2,
      stage: stage as 0 | 1 | 2 | 3,
    }));
  }

  async add(filepath: string): Promise<void> {
    const fs = this.getFs();
    const dir = "/";

    await git.add({ fs, dir, filepath });
  }

  async addAll(): Promise<void> {
    const status = await this.getStatus();
    for (const file of status) {
      if (file.workdir !== file.head) {
        await this.add(file.filepath);
      }
    }
  }

  async commit(message: string): Promise<string> {
    const fs = this.getFs();
    const dir = "/";

    const sha = await git.commit({
      fs,
      dir,
      message,
      author: {
        name: this.authorName,
        email: this.authorEmail,
      },
    });

    return sha;
  }

  async push(remote: string = "origin", branch: string = "main"): Promise<void> {
    if (!this.authToken) {
      throw new Error("Git authentication token required");
    }

    const fs = this.getFs();
    const dir = "/";

    await git.push({
      fs,
      http,
      dir,
      remote,
      ref: branch,
      onAuth: () => ({
        username: this.authToken!,
        password: "x-oauth-basic",
      }),
    });
  }

  async pull(remote: string = "origin", branch: string = "main"): Promise<void> {
    if (!this.authToken) {
      throw new Error("Git authentication token required");
    }

    const fs = this.getFs();
    const dir = "/";

    await git.pull({
      fs,
      http,
      dir,
      remote,
      ref: branch,
      onAuth: () => ({
        username: this.authToken!,
        password: "x-oauth-basic",
      }),
    });
  }

  async log(depth: number = 10): Promise<GitLogEntry[]> {
    const fs = this.getFs();
    const dir = "/";

    const commits = await git.log({
      fs,
      dir,
      depth,
    });

    return commits.map((c) => ({
      oid: c.oid,
      message: c.commit.message,
      timestamp: c.commit.author.timestamp,
      author: {
        name: c.commit.author.name,
        email: c.commit.author.email,
      },
    }));
  }

  async commitAndPush(message: string): Promise<{ sha: string; pushed: boolean }> {
    await this.addAll();
    const sha = await this.commit(message);

    try {
      await this.push();
      return { sha, pushed: true };
    } catch {
      return { sha, pushed: false };
    }
  }

  async getRemotes(): Promise<Array<{ remote: string; url: string }>> {
    const fs = this.getFs();
    const dir = "/";

    const remotes = await git.listRemotes({ fs, dir });
    return remotes;
  }

  async addRemote(name: string, url: string): Promise<void> {
    const fs = this.getFs();
    const dir = "/";

    await git.addRemote({ fs, dir, remote: name, url });
  }

  async getCurrentBranch(): Promise<string> {
    const fs = this.getFs();
    const dir = "/";

    const branch = await git.currentBranch({ fs, dir });
    return branch || "main";
  }

  async checkout(branch: string): Promise<void> {
    const fs = this.getFs();
    const dir = "/";

    await git.checkout({ fs, dir, ref: branch });
  }

  async createBranch(name: string): Promise<void> {
    const fs = this.getFs();
    const dir = "/";

    await git.branch({ fs, dir, ref: name });
  }
}

export const gitService = new GitService();
