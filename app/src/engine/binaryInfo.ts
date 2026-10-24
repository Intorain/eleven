import { closeSync, openSync, readSync } from "node:fs";
import { type FileHandle, open } from "node:fs/promises";

/** What a file's header says it is: the format, and each architecture inside with where its bytes sit. */
export type BinaryInfo = {
  readonly format: "Mach-O" | "ELF" | "PE" | "File";
  readonly slices: readonly Slice[];
};

export type Slice = { readonly arch: string; readonly offset: number; readonly size: number };

const MACH_CPU: Readonly<Record<number, string>> = {
  0x7: "i386",
  0x01000007: "x86_64",
  0xc: "arm",
  0x0100000c: "arm64",
  0x0200000c: "arm64_32",
  0x12: "ppc",
  0x01000012: "ppc64",
};

const CPU_SUBTYPE_ARM64E = 2;

const ELF_MACHINE: Readonly<Record<number, string>> = { 3: "i386", 8: "mips", 20: "ppc", 21: "ppc64", 40: "arm", 62: "x86_64", 183: "arm64", 243: "riscv" };

const PE_MACHINE: Readonly<Record<number, string>> = { 0x14c: "i386", 0x8664: "x86_64", 0xaa64: "arm64", 0x1c0: "arm", 0x1c4: "arm" };

/** Java class files share the fat magic; a real universal binary lists only a handful of slices. */
const MAX_FAT_SLICES = 32;

function machArch(cpu: number, subtype: number): string {
  const name = MACH_CPU[cpu] ?? "";
  return name === "arm64" && (subtype & 0xff) === CPU_SUBTYPE_ARM64E ? "arm64e" : name;
}

function fatSlices(head: Buffer, wide: boolean): readonly Slice[] | null {
  const count = head.readUInt32BE(4);
  if (count === 0 || count > MAX_FAT_SLICES) return null;
  const step = wide ? 32 : 20;
  const slices: Slice[] = [];
  for (let ix = 0; ix < count; ix++) {
    const at = 8 + ix * step;
    if (at + step > head.length) return null;
    const cpu = head.readUInt32BE(at);
    const subtype = head.readUInt32BE(at + 4);
    const offset = wide ? Number(head.readBigUInt64BE(at + 8)) : head.readUInt32BE(at + 8);
    const size = wide ? Number(head.readBigUInt64BE(at + 16)) : head.readUInt32BE(at + 12);
    slices.push({ arch: machArch(cpu, subtype), offset, size });
  }
  return slices;
}

/** Reads a binary's format and architectures from its header alone, the same on every OS. */
export function readBinaryInfo(head: Buffer, fileSize: number): BinaryInfo {
  const none: BinaryInfo = { format: "File", slices: [] };
  if (head.length < 8) return none;
  const be = head.readUInt32BE(0);
  if (be === 0xcafebabe || be === 0xcafebabf) {
    const slices = fatSlices(head, be === 0xcafebabf);
    return slices ? { format: "Mach-O", slices } : none;
  }
  if (be === 0xfeedface || be === 0xfeedfacf) return { format: "Mach-O", slices: [{ arch: machArch(head.readUInt32BE(4), head.readUInt32BE(8)), offset: 0, size: fileSize }] };
  if (be === 0xcefaedfe || be === 0xcffaedfe) return { format: "Mach-O", slices: [{ arch: machArch(head.readUInt32LE(4), head.readUInt32LE(8)), offset: 0, size: fileSize }] };
  if (be === 0x7f454c46 && head.length >= 20) {
    const machine = head[5] === 2 ? head.readUInt16BE(18) : head.readUInt16LE(18);
    return { format: "ELF", slices: [{ arch: ELF_MACHINE[machine] ?? "", offset: 0, size: fileSize }] };
  }
  if (head[0] === 0x4d && head[1] === 0x5a && head.length >= 0x40) {
    const pe = head.readUInt32LE(0x3c);
    if (pe + 6 <= head.length && head.readUInt32BE(pe) === 0x50450000) return { format: "PE", slices: [{ arch: PE_MACHINE[head.readUInt16LE(pe + 4)] ?? "", offset: 0, size: fileSize }] };
  }
  return none;
}

const HEAD_BYTES = 4096;

export function binaryInfoOf(path: string, fileSize: number): BinaryInfo {
  const head = Buffer.alloc(HEAD_BYTES);
  const fd = openSync(path, "r");
  try {
    return readBinaryInfo(head.subarray(0, readSync(fd, head, 0, HEAD_BYTES, 0)), fileSize);
  } finally {
    closeSync(fd);
  }
}

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SYMTAB = 0x2;
const LC_SEGMENT_64 = 0x19;
const SECTION_BYTES = 80;

async function readAt(file: FileHandle, at: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  const { bytesRead } = await file.read(bytes, 0, length, at);
  return bytes.subarray(0, bytesRead);
}

/** Whether Ghidra runs its Objective-C Message Analyzer on this file: the same test Ghidra 12 makes, read from the header. */
export async function hasObjcMessages(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    const slice = readBinaryInfo(await readAt(file, 0, HEAD_BYTES), size).slices[0];
    if (!slice) return false;
    const header = await readAt(file, slice.offset, 32);
    if (header.length < 32 || header.readUInt32LE(0) !== MH_MAGIC_64) return false;
    const commands = await readAt(file, slice.offset + 32, header.readUInt32LE(20));
    const sections: string[] = [];
    let strings: { readonly at: number; readonly size: number } | null = null;
    for (let at = 0, ix = 0; ix < header.readUInt32LE(16) && at + 8 <= commands.length; ix++) {
      const cmd = commands.readUInt32LE(at);
      if (cmd === LC_SEGMENT_64 && at + 72 <= commands.length) {
        for (let s = 0; s < commands.readUInt32LE(at + 64); s++) {
          const name = at + 72 + s * SECTION_BYTES;
          if (name + 16 <= commands.length) sections.push(commands.toString("latin1", name, name + 16).replace(/\0.*$/s, ""));
        }
      }
      if (cmd === LC_SYMTAB && at + 24 <= commands.length) strings = { at: commands.readUInt32LE(at + 16), size: commands.readUInt32LE(at + 20) };
      at += commands.readUInt32LE(at + 4) || commands.length;
    }
    if (!sections.some((name) => name.startsWith("__objc_"))) return false;
    if (sections.includes("__objc_stubs")) return true;
    return strings !== null && (await readAt(file, slice.offset + strings.at, strings.size)).includes("\0_objc_msgSend");
  } catch {
    return false;
  } finally {
    await file.close();
  }
}
