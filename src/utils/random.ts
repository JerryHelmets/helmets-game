export function hash32(str: string) {
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 0xCAFEBABE;
}
export function xorshift32(seed: number) {
  let x = seed || 0xDEADBEEF;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) / 0xFFFFFFFF);
  };
}
