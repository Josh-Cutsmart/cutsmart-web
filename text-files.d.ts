// A .txt imported into the code is its text (next.config.ts).
declare module "*.txt" {
  const text: string;
  export default text;
}
