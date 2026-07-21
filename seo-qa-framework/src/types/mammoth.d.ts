declare module 'mammoth' {
  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface MammothResult {
    value: string;
    messages: MammothMessage[];
  }

  export interface MammothInput {
    path?: string;
    buffer?: Buffer;
  }

  export function convertToHtml(input: MammothInput): Promise<MammothResult>;
  export function extractRawText(input: MammothInput): Promise<MammothResult>;
}
