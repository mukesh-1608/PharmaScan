import { useState, useCallback, useEffect } from "react";
import {
  FileCode,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Scan,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ProgressStepper } from "@/components/ProgressStepper";
import { ImageUploadZone } from "@/components/ImageUploadZone";
import { ImagePreviewGrid } from "@/components/ImagePreviewGrid";
import { OCRResultsPanel } from "@/components/OCRResultsPanel";
import { XMLPreview } from "@/components/XMLPreview";
import { ThemeToggle } from "@/components/ThemeToggle";
import { downloadFile } from "@/lib/parser";
import type { UploadedImage } from "@shared/schema";

export default function Home() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [xmlOutput, setXmlOutput] = useState("");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (uploadedImages.length > 0) {
      setCompletedSteps((prev) => {
        if (prev.includes(1)) return prev;
        return [...prev, 1];
      });
    } else {
      setCompletedSteps((prev) => prev.filter((s) => s !== 1));
      setCurrentStep((prev) => (prev > 1 ? 1 : prev));
    }
  }, [uploadedImages.length]);

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      const newImages: UploadedImage[] = files.map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        file,
        preview: URL.createObjectURL(file),
        status: "pending" as const,
        progress: 0,
        rawText: "",
        parsedData: null,
      }));

      setUploadedImages((prev) => [...prev, ...newImages]);
      toast({ title: "Images added", description: `Ready to process ${files.length} files.` });
    },
    [toast]
  );

  const handleRemoveImage = useCallback((id: string) => {
    setUploadedImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) URL.revokeObjectURL(image.preview);
      const remaining = prev.filter((img) => img.id !== id);
      if (remaining.length === 0) {
        setXmlOutput("");
        setCompletedSteps([]);
        setCurrentStep(1);
      }
      return remaining;
    });
  }, []);

  const handleRetryFailed = useCallback(() => {
    setUploadedImages((prev) =>
      prev.map((img) =>
        img.status === "error"
          ? { ...img, status: "pending" as const, error: undefined, progress: 0 }
          : img
      )
    );
  }, []);

  const processImages = useCallback(async () => {
    const pendingImages = uploadedImages.filter(
      (img) => img.status === "pending" || img.status === "error"
    );

    if (pendingImages.length === 0) {
        toast({
            title: "No images to process",
            description: "All images have already been processed.",
            variant: "destructive",
        });
        return;
    }

    setProcessing(true);
    setCurrentStep(2);

    let successCount = 0;

    for (const image of pendingImages) {
      setUploadedImages((prev) =>
        prev.map((img) =>
          img.id === image.id
            ? { ...img, status: "processing" as const, progress: 20 }
            : img
        )
      );

      try {
        const formData = new FormData();
        formData.append("image", image.file);

        const response = await fetch("/api/process-image", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Server processing failed");
        }

        const data = await response.json();

        setUploadedImages((prev) =>
          prev.map((img) =>
            img.id === image.id
              ? {
                  ...img,
                  status: "complete" as const,
                  progress: 100,
                  rawText: data.rawText, 
                }
              : img
          )
        );

        setXmlOutput((prev) => (prev ? prev + "\n" + data.xml : data.xml));
        successCount++;

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Error";
        setUploadedImages((prev) =>
          prev.map((img) =>
            img.id === image.id
              ? { ...img, status: "error" as const, error: errorMessage }
              : img
          )
        );
        toast({
          title: "Processing Error",
          description: `Failed to process ${image.file.name}: ${errorMessage}`,
          variant: "destructive",
        });
      }
    }

    setProcessing(false);
    
    if (successCount > 0) {
        setCompletedSteps((prev) => Array.from(new Set([...prev, 2, 3, 4])));
        setCurrentStep(4);
        toast({
            title: "Processing Complete",
            description: `XML generated successfully for ${successCount} file(s).`,
        });
    }

  }, [uploadedImages, toast]);

  const handleDownloadXML = useCallback(() => {
    if (!xmlOutput) return;
    downloadFile(xmlOutput, "RxSync_Data.xml", "application/xml");
    toast({ title: "Downloaded", description: "XML file saved." });
  }, [xmlOutput, toast]);

  const hasImages = uploadedImages.length > 0;
  const isProcessing = processing;
  const hasFailedImages = uploadedImages.some((img) => img.status === "error");
  const hasPendingImages = uploadedImages.some((img) => img.status === "pending");

  return (
    <div className="min-h-screen bg-background" data-testid="home-page">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4 h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center" data-testid="logo">
                <Scan className="w-5 h-5 text-primary-foreground" />
              </div>
              <div className="flex flex-col">
                <h1 className="text-2xl font-bold text-foreground leading-none" data-testid="text-app-title">
                  RxSync
                </h1>
                <p className="text-xs text-muted-foreground italic mt-1">
                  Built by Juara IT Solutions
                </p>
              </div>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-8">
          {/* Progress Stepper */}
          <Card>
            <CardContent className="py-6">
              <ProgressStepper
                currentStep={currentStep}
                completedSteps={completedSteps}
              />
            </CardContent>
          </Card>

          {/* Step 1: Upload */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                  1
                </div>
                <div>
                  <CardTitle className="text-xl">Upload Documents</CardTitle>
                  <CardDescription>
                    Upload pharmacy order forms (JPEG/PNG)
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <ImageUploadZone
                onFilesSelected={handleFilesSelected}
                disabled={processing}
              />
              <ImagePreviewGrid
                images={uploadedImages}
                onRemove={handleRemoveImage}
                disabled={processing}
              />
            </CardContent>
          </Card>

          {/* Step 2: Processing */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                    2
                  </div>
                  <div>
                    <CardTitle className="text-xl">AI Processing</CardTitle>
                    <CardDescription>
                      Extract & Structure Data (AWS Textract + Gemini)
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {hasFailedImages && (
                    <Button
                      variant="outline"
                      onClick={handleRetryFailed}
                      disabled={processing}
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retry Failed
                    </Button>
                  )}
                  <Button
                    onClick={processImages}
                    disabled={!hasImages || processing || !hasPendingImages}
                  >
                    {processing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 mr-2" />
                        Start Extraction
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <OCRResultsPanel images={uploadedImages} />
            </CardContent>
          </Card>

          {/* Step 3: XML Output */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-semibold text-primary">
                    3
                  </div>
                  <div>
                    <CardTitle className="text-xl">XML Output</CardTitle>
                    <CardDescription>
                      Generated Medical XML Data
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="outline"
                  onClick={handleDownloadXML}
                  disabled={!xmlOutput}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download XML
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <XMLPreview xml={xmlOutput} />
            </CardContent>
          </Card>
        </div>
      </main>

      <footer className="border-t mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-sm text-muted-foreground text-center">
            RxSync — Powered by Juara IT Solutions
          </p>
        </div>
      </footer>
    </div>
  );
}