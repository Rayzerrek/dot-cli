import {
  type Dirent,
  type Stats,
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
} from "fs";
import { dirname, join, resolve } from "path";

import { sameFilesystemPath } from "./paths.js";
import { errorMessage } from "./system.js";

function equalFileContents(
  source: string,
  destination: string,
  sourceBuffer: Buffer,
  destinationBuffer: Buffer,
): boolean {
  const sourceFd = openSync(source, "r");
  try {
    const destinationFd = openSync(destination, "r");
    try {
      for (let position = 0; ; ) {
        const sourceRead = readSync(
          sourceFd,
          sourceBuffer,
          0,
          sourceBuffer.length,
          position,
        );
        const destinationRead = readSync(
          destinationFd,
          destinationBuffer,
          0,
          destinationBuffer.length,
          position,
        );
        if (
          sourceRead !== destinationRead ||
          !sourceBuffer
            .subarray(0, sourceRead)
            .equals(destinationBuffer.subarray(0, destinationRead))
        )
          return false;
        if (sourceRead === 0) return true;
        position += sourceRead;
      }
    } finally {
      closeSync(destinationFd);
    }
  } finally {
    closeSync(sourceFd);
  }
}

/** Compares copy contents and POSIX permissions with bounded memory; does not follow nested symbolic links. */
export function compareDotfileCopies(
  source: string,
  destination: string,
): { ok: true; matches: boolean } | { ok: false; error: string } {
  const sourceBuffer = Buffer.allocUnsafe(64 * 1024);
  const destinationBuffer = Buffer.allocUnsafe(sourceBuffer.length);

  function equalCopyPaths(
    sourcePath: string,
    destinationPath: string,
    sourceStat: Stats | Dirent,
    destinationStat: Stats | Dirent,
  ): boolean {
    if (sourceStat.isSymbolicLink() && destinationStat.isSymbolicLink()) {
      const sourceTarget = readlinkSync(sourcePath);
      const destinationTarget = readlinkSync(destinationPath);
      return (
        sourceTarget === destinationTarget ||
        sameFilesystemPath(
          resolve(dirname(sourcePath), sourceTarget),
          resolve(dirname(destinationPath), destinationTarget),
        )
      );
    }
    if (process.platform !== "win32") {
      const sourceMode =
        "mode" in sourceStat ? sourceStat.mode : lstatSync(sourcePath).mode;
      const destinationMode =
        "mode" in destinationStat
          ? destinationStat.mode
          : lstatSync(destinationPath).mode;
      if ((sourceMode & 0o777) !== (destinationMode & 0o777)) return false;
    }
    if (sourceStat.isFile() && destinationStat.isFile()) {
      return equalFileContents(
        sourcePath,
        destinationPath,
        sourceBuffer,
        destinationBuffer,
      );
    }
    if (sourceStat.isDirectory() && destinationStat.isDirectory()) {
      const sourceEntries = readdirSync(sourcePath, { withFileTypes: true });
      const destinationEntries = new Map(
        readdirSync(destinationPath, { withFileTypes: true }).map((entry) => [
          entry.name,
          entry,
        ]),
      );
      return (
        sourceEntries.length === destinationEntries.size &&
        sourceEntries.every((entry) => {
          const destinationEntry = destinationEntries.get(entry.name);
          return (
            destinationEntry !== undefined &&
            equalCopyPaths(
              join(sourcePath, entry.name),
              join(destinationPath, entry.name),
              entry,
              destinationEntry,
            )
          );
        })
      );
    }
    return false;
  }

  try {
    return {
      ok: true,
      matches: equalCopyPaths(
        source,
        destination,
        lstatSync(source),
        lstatSync(destination),
      ),
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
