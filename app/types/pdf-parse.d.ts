// types/pdf-parse.d.ts
declare module 'pdf-parse' {
    interface PDFParseResult {
      text: string;
      numpages: number;
      info: {
        PDFFormatVersion: string;
        IsAcroFormPresent: boolean;
        IsXFAPresent: boolean;
        Title?: string;
        Author?: string;
        Subject?: string;
        Keywords?: string;
        Creator?: string;
        Producer?: string;
        CreationDate?: string;
        ModDate?: string;
        [key: string]: any;
      };
      metadata: any;
      version: string;
    }
  
    function PDFParse(dataBuffer: Buffer, options?: any): Promise<PDFParseResult>;
    
    namespace PDFParse {}
    
    export = PDFParse;
  }