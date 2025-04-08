// app/page.tsx
'use client'

import React, { useState, ChangeEvent } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, FileText, Download, RefreshCw } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

type ConversionMode = 'wordToPdf' | 'pdfToWord';

interface ConvertedFile {
  name: string;
  url: string;
  size: string;
}

export default function FileConverter() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [convertedFile, setConvertedFile] = useState<ConvertedFile | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [mode, setMode] = useState<ConversionMode>('wordToPdf');

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file extensions
    const validExtensions = mode === 'wordToPdf' 
      ? ['.doc', '.docx'] 
      : ['.pdf'];
      
    const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    
    if (!validExtensions.includes(extension)) {
      setError(`Mohon pilih file ${mode === 'wordToPdf' ? 'Word (.doc, .docx)' : 'PDF (.pdf)'}`);
      setSelectedFile(null);
      return;
    }
    
    setError('');
    setSelectedFile(file);
    setConvertedFile(null);
  };

  const handleConvert = async () => {
    if (!selectedFile) {
      setError('Silakan pilih file terlebih dahulu');
      return;
    }
  
    setLoading(true);
    setProgress(0);
    
    try {
      // Simulasi progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 300);
      
      // Create form data
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      // Send to API
      const response = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });
      
      clearInterval(progressInterval);
      
      // Periksa status respons
      if (!response.ok) {
        let errorMessage = 'Gagal mengkonversi file';
        
        // Periksa header Content-Type untuk menentukan format respons
        const contentType = response.headers.get('Content-Type') || '';
        
        if (contentType.includes('application/json')) {
          // Respons adalah JSON, parse sebagai JSON
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } else {
          // Respons mungkin HTML atau teks, gunakan respons generik
          errorMessage = `Server error: ${response.status} ${response.statusText}`;
        }
        
        throw new Error(errorMessage);
      }
      
      setProgress(100);
      
      // Respons berhasil, proses file sebagai blob
      const blob = await response.blob();
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'converted-file';
      
      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch && filenameMatch[1]) {
          filename = decodeURIComponent(filenameMatch[1]);
        }
      }
      
      // If no filename is specified in headers, create one
      if (!filename.includes('.')) {
        filename = mode === 'wordToPdf' 
          ? `${selectedFile.name.replace(/\.[^/.]+$/, '')}.pdf` 
          : `${selectedFile.name.replace(/\.[^/.]+$/, '')}.docx`;
      }
      
      const url = URL.createObjectURL(blob);
      
      setConvertedFile({
        name: filename,
        url: url,
        size: (blob.size / 1024).toFixed(2) + ' KB'
      });
      
      setLoading(false);
    } catch (err) {
      console.error('Konversi error:', err);
      setError(err instanceof Error ? err.message : 'Gagal mengkonversi file. Silakan coba lagi.');
      setLoading(false);
      setProgress(0);
    }
  };

  const handleTabChange = (value: string) => {
    setMode(value as ConversionMode);
    setSelectedFile(null);
    setConvertedFile(null);
    setError('');
    setProgress(0);
  };

  return (
    <div className="flex items-center justify-center w-full min-h-screen bg-gray-50 py-8">
      <Card className="w-full max-w-xl mx-4 shadow-lg">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Konverter File</CardTitle>
          <CardDescription>Konversi file Word ke PDF dan sebaliknya dengan mudah</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="wordToPdf" onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="wordToPdf">Word ke PDF</TabsTrigger>
              <TabsTrigger value="pdfToWord">PDF ke Word</TabsTrigger>
            </TabsList>
            
            <TabsContent value="wordToPdf" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="wordFile">Pilih file Word (.doc, .docx)</Label>
                <div className="flex items-center gap-2">
                  <Input 
                    id="wordFile" 
                    type="file" 
                    accept=".doc,.docx" 
                    onChange={handleFileChange}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={() => document.getElementById('wordFile')?.click()}>
                    <Upload className="w-4 h-4 mr-2" />
                    Unggah
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="pdfToWord" className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pdfFile">Pilih file PDF (.pdf)</Label>
                <div className="flex items-center gap-2">
                  <Input 
                    id="pdfFile" 
                    type="file" 
                    accept=".pdf" 
                    onChange={handleFileChange}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={() => document.getElementById('pdfFile')?.click()}>
                    <Upload className="w-4 h-4 mr-2" />
                    Unggah
                  </Button>
                </div>
              </div>
            </TabsContent>
            
            {selectedFile && (
              <div className="flex items-center gap-2 p-3 mt-4 border rounded-md bg-gray-50">
                <FileText className="w-5 h-5 text-blue-500" />
                <div className="flex-1 overflow-hidden">
                  <div className="truncate">{selectedFile.name}</div>
                  <div className="text-xs text-gray-500">
                    {(selectedFile.size / 1024).toFixed(2)} KB
                  </div>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => {
                    setSelectedFile(null);
                    setConvertedFile(null);
                    setProgress(0);
                  }}
                >
                  Hapus
                </Button>
              </div>
            )}
            
            {loading && (
              <div className="space-y-2 mt-4">
                <div className="flex justify-between">
                  <span className="text-sm">Sedang Mengkonversi...</span>
                  <span className="text-sm">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2" />
              </div>
            )}
            
            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            
            {convertedFile && (
              <div className="flex flex-col gap-2 p-4 mt-4 border rounded-md bg-green-50">
                <div className="flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-green-600" />
                  <span className="font-medium text-green-700">Berhasil dikonversi!</span>
                </div>
                <div className="flex flex-col mt-2">
                  <span className="truncate font-medium">{convertedFile.name}</span>
                  <span className="text-xs text-gray-500">{convertedFile.size}</span>
                </div>
                <Button size="sm" className="mt-2" asChild>
                  <a href={convertedFile.url} download={convertedFile.name}>
                    <Download className="w-4 h-4 mr-2" />
                    Unduh File Hasil Konversi
                  </a>
                </Button>
              </div>
            )}
          </Tabs>
        </CardContent>
        <CardFooter className="flex flex-col">
          <Button 
            className="w-full" 
            onClick={handleConvert} 
            disabled={!selectedFile || loading}
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Sedang Mengkonversi...
              </>
            ) : (
              'Konversi File'
            )}
          </Button>
          
          <div className="mt-4 text-xs text-center text-gray-500 space-y-1">
            <p>
              Batas ukuran file: 10MB. Format yang didukung: .doc, .docx, .pdf
            </p>
            <p>
              Semua file diproses di server dan akan dihapus secara otomatis setelah konversi.
            </p>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
}