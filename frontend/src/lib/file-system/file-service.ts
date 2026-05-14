export interface FileServiceConfig {
  directoryHandle: FileSystemDirectoryHandle;
}

export class FileService {
  private directoryHandle: FileSystemDirectoryHandle | null = null;

  // Cheap counter incremented on every FSA read. Used by the startup loading
  // screen to show "Loaded N files…" so the user knows something's happening
  // even when OneDrive is being slow.
  private readCount = 0;

  setDirectoryHandle(handle: FileSystemDirectoryHandle): void {
    this.directoryHandle = handle;
  }

  getDirectoryHandle(): FileSystemDirectoryHandle | null {
    return this.directoryHandle;
  }

  clearDirectoryHandle(): void {
    this.directoryHandle = null;
  }

  getReadCount(): number {
    return this.readCount;
  }

  resetReadCount(): void {
    this.readCount = 0;
  }

  private bumpReadCount(): void {
    this.readCount += 1;
  }

  async verifyPermission(requestWrite: boolean = true): Promise<boolean> {
    if (!this.directoryHandle) {
      console.log("verifyPermission: no directoryHandle");
      return false;
    }

    const mode = requestWrite ? "readwrite" : "read";

    const handleWithPermission = this.directoryHandle as unknown as {
      queryPermission?: (opts: { mode: string }) => Promise<string>;
      requestPermission?: (opts: { mode: string }) => Promise<string>;
    };

    if (handleWithPermission.queryPermission) {
      try {
        const permission = await handleWithPermission.queryPermission({ mode });
        console.log("queryPermission result:", permission);

        if (permission === "granted") {
          return true;
        }

        if (permission === "prompt" && handleWithPermission.requestPermission) {
          const requestResult = await handleWithPermission.requestPermission({ mode });
          console.log("requestPermission result:", requestResult);
          return requestResult === "granted";
        }
      } catch (err) {
        console.error("Permission check error:", err);
        return false;
      }
    }

    return true;
  }

  private async getHandleByPath(
    path: string,
    create: boolean = false
  ): Promise<FileSystemHandle | null> {
    if (!this.directoryHandle) return null;

    const parts = path.split("/").filter(Boolean);
    console.log("[getHandleByPath] path:", path, "parts:", parts);
    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      try {
        const nextHandle = await currentHandle.getDirectoryHandle(part);
        console.log("[getHandleByPath] Got directory:", part, "kind:", nextHandle.kind);
        currentHandle = nextHandle;
      } catch {
        console.log("[getHandleByPath] getDirectoryHandle failed for:", part, "isLast:", isLast);
        if (isLast) {
          if (create) {
            try {
              const fileHandle = await currentHandle.getFileHandle(part, { create: true });
              console.log("[getHandleByPath] Created file:", part);
              return fileHandle;
            } catch {
              console.log("[getHandleByPath] Failed to create file:", part);
              return null;
            }
          } else {
            try {
              const fileHandle = await currentHandle.getFileHandle(part);
              console.log("[getHandleByPath] Got file:", part);
              return fileHandle;
            } catch {
              console.log("[getHandleByPath] getFileHandle also failed for:", part);
              return null;
            }
          }
        } else if (create) {
          try {
            currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
            console.log("[getHandleByPath] Created directory:", part);
          } catch {
            console.log("[getHandleByPath] Failed to create directory:", part);
            return null;
          }
        } else {
          console.log("[getHandleByPath] Returning null, can't find:", part);
          return null;
        }
      }
    }

    console.log("[getHandleByPath] Returning currentHandle:", currentHandle.name, "kind:", currentHandle.kind);
    return currentHandle;
  }

  async ensureDir(dirPath: string): Promise<FileSystemDirectoryHandle | null> {
    if (!this.directoryHandle) return null;

    const parts = dirPath.split("/").filter(Boolean);
    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (const part of parts) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
      } catch {
        return null;
      }
    }

    return currentHandle;
  }

  async fileExists(path: string): Promise<boolean> {
    if (!this.directoryHandle) return false;

    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return true;

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (let i = 0; i < parts.length - 1; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
      } catch {
        return false;
      }
    }

    try {
      await currentHandle.getFileHandle(parts[parts.length - 1]);
      return true;
    } catch {
      return false;
    }
  }

  async readJson<T>(path: string): Promise<T | null> {
    if (!this.directoryHandle) {
      console.log(`[fileService.readJson] No directoryHandle, returning null for: ${path}`);
      return null;
    }

    const handle = await this.getHandleByPath(path);
    if (!handle || handle.kind !== "file") {
      console.log(`[fileService.readJson] Not a file or null: ${path}, handle:`, handle ? { kind: handle.kind, name: handle.name } : null);
      return null;
    }

    try {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const text = await file.text();
      const result = JSON.parse(text) as T;
      this.bumpReadCount();
      console.log(`[fileService.readJson] Successfully read: ${path}`);
      return result;
    } catch (err) {
      console.error(`[fileService.readJson] Error reading ${path}:`, err);
      return null;
    }
  }

  async writeJson<T>(path: string, data: T): Promise<void> {
    if (!this.directoryHandle) throw new Error("No directory handle set");

    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error("Invalid path");

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    }

    const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  }

  async deleteFile(path: string): Promise<boolean> {
    if (!this.directoryHandle) return false;

    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return false;

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (let i = 0; i < parts.length - 1; i++) {
      try {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
      } catch {
        return false;
      }
    }

    try {
      await currentHandle.removeEntry(parts[parts.length - 1]);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dirPath: string): Promise<string[]> {
    console.log(`[fileService.listFiles] Called with dirPath: ${dirPath}, connected: ${this.isConnected()}`);
    
    if (!this.directoryHandle) {
      console.log(`[fileService.listFiles] No directory handle, returning empty array`);
      return [];
    }

    const dirHandle = await this.getHandleByPath(dirPath);
    console.log(`[fileService.listFiles] getHandleByPath result:`, dirHandle ? { kind: dirHandle.kind, name: dirHandle.name } : null);
    
    if (!dirHandle || dirHandle.kind !== "directory") {
      console.log(`[fileService.listFiles] Not a directory or null, returning empty array`);
      return [];
    }

    const files: string[] = [];
    const directoryHandle = dirHandle as FileSystemDirectoryHandle;

    for await (const entry of (directoryHandle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
      if (entry.kind === "file") {
        files.push(entry.name);
      }
    }

    console.log(`[fileService.listFiles] Found ${files.length} files in ${dirPath}:`, files);
    this.bumpReadCount();
    return files.sort();
  }

  async listDirectories(dirPath: string): Promise<string[]> {
    if (!this.directoryHandle) return [];

    const dirHandle = await this.getHandleByPath(dirPath);
    if (!dirHandle || dirHandle.kind !== "directory") return [];

    const dirs: string[] = [];
    const directoryHandle = dirHandle as FileSystemDirectoryHandle;

    for await (const entry of (directoryHandle as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
      if (entry.kind === "directory") {
        dirs.push(entry.name);
      }
    }

    this.bumpReadCount();
    return dirs.sort();
  }

  async readFileAsBlob(path: string): Promise<Blob | null> {
    if (!this.directoryHandle) return null;

    const handle = await this.getHandleByPath(path);
    if (!handle || handle.kind !== "file") return null;

    try {
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      this.bumpReadCount();
      return file;
    } catch {
      return null;
    }
  }

  async writeFileFromBlob(path: string, blob: Blob): Promise<void> {
    if (!this.directoryHandle) throw new Error("No directory handle set");

    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) throw new Error("Invalid path");

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    }

    const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async createWritable(path: string): Promise<FileSystemWritableFileStream | null> {
    if (!this.directoryHandle) return null;

    const parts = path.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) return null;

    let currentHandle: FileSystemDirectoryHandle = this.directoryHandle;

    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create: true });
    }

    try {
      const fileHandle = await currentHandle.getFileHandle(fileName, { create: true });
      return await fileHandle.createWritable();
    } catch {
      return null;
    }
  }

  async getDirectory(dirPath: string): Promise<FileSystemDirectoryHandle | null> {
    console.log("getDirectory called with:", dirPath, "handle exists:", !!this.directoryHandle);
    const handle = await this.getHandleByPath(dirPath);
    console.log("getHandleByPath result:", handle?.kind, handle?.name);
    if (!handle || handle.kind !== "directory") return null;
    return handle as FileSystemDirectoryHandle;
  }

  isConnected(): boolean {
    const connected = this.directoryHandle !== null;
    console.log("isConnected:", connected);
    return connected;
  }
}

export const fileService = new FileService();
