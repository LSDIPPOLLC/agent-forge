export interface OutputAdapter {
  write(params: { name: string; code: string; description: string }): Promise<void>;
  getPath(name: string): string;
}
