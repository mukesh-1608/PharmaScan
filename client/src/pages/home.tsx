import { useState, useCallback, useEffect } from "react";
import {
  FileText,
  Download,
  Loader2,
  Play,
  RefreshCw,
  Activity,
  CheckCircle2,
  FileCode2,
  Copy,
  ExternalLink,
  ChevronDown,
  FileType
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ImageUploadZone } from "@/components/ImageUploadZone";
import { ImagePreviewGrid } from "@/components/ImagePreviewGrid";
import { ThemeToggle } from "@/components/ThemeToggle";
import { downloadFile } from "@/lib/parser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UploadedImage } from "@shared/schema";

// --- Types & Constants ---
type ProcessingStage = "idle" | "uploading" | "ocr" | "reasoning" | "validating" | "complete";

const STAGE_MESSAGES = {
  idle: "Ready to process",
  uploading: "Securely encrypting and uploading to S3...",
  ocr: "AWS Textract: Analyzing physical document layout...",
  reasoning: "Gemini AI: Extracting clinical entities & logic...",
  validating: "Enforcing XML schema & medical compliance...",
  complete: "Processing complete."
};

// --- Helper: Convert XML to CSV ---
const convertXmlToCsv = (xmlString: string) => {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(`<Root>${xmlString}</Root>`, "text/xml");
    const docs = Array.from(xmlDoc.getElementsByTagName("MedicalDocument"));
    
    // Define Headers
    const headers = [
      "Order ID", 
      "Patient Name", "DOB", "Gender", 
      "Doctor Name", "License", "Clinic", 
      "Medicine", "Dosage", "Frequency", "Duration", 
      "Height", "Weight", "Blood Type", "BP"
    ];
    
    // Extract Rows
    const rows = docs.map(doc => {
      const getText = (selector: string) => {
        const el = doc.querySelector(selector);
        return el?.textContent?.replace(/MISSING|UNREADABLE/g, "")?.trim() || "";
      };

      return [
        // ID (Extract from Notes if possible)
        getText("Notes")?.replace("Order ID:", "").trim(),
        // Patient
        getText("Patient > Name"),
        getText("Patient > DOB"),
        getText("Patient > Gender"),
        // Doctor
        getText("Doctor > Name"),
        getText("Doctor > LicenseNumber"),
        getText("Doctor > Clinic"),
        // Prescription
        getText("Prescription > Medicine > Name"),
        getText("Prescription > Medicine > Dosage"),
        getText("Prescription > Medicine > Frequency"),
        getText("Prescription > Medicine > Duration"),
        // Vitals
        getText("Vitals > Height"),
        getText("Vitals > Weight"),
        getText("Vitals > BloodType"),
        getText("Vitals > BloodPressure"),
      ].map(field => `"${field.replace(/"/g, '""')}"`).join(","); // Escape CSV quotes
    });
    
    return [headers.join(","), ...rows].join("\n");
  } catch (e) {
    console.error("CSV Conversion Failed", e);
    return "";
  }
};

export default function Home() {
  const { toast } = useToast();
  
  // State
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [xmlOutput, setXmlOutput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("idle");
  const [progressValue, setProgressValue] = useState(0);

  // Scroll to top on step change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeStep]);

  // Handlers
  const handleFilesSelected = useCallback((files: File[]) => {
    const newImages: UploadedImage[] = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      file,
      preview: URL.createObjectURL(file),
      status: "pending",
      progress: 0,
      rawText: "",
      parsedData: null,
    }));
    setUploadedImages((prev) => [...prev, ...newImages]);
    toast({ 
      title: "Documents Added", 
      description: `${files.length} file(s) ready for processing.` 
    });
  }, [toast]);

  const handleRemoveImage = useCallback((id: string) => {
    setUploadedImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) URL.revokeObjectURL(image.preview);
      const remaining = prev.filter((img) => img.id !== id);
      if (remaining.length === 0) {
        setXmlOutput("");
        setActiveStep(1);
      }
      return remaining;
    });
  }, []);

  const handleRetry = useCallback(() => {
    setUploadedImages((prev) =>
      prev.map((img) =>
        img.status === "error"
          ? { ...img, status: "pending", error: undefined, progress: 0 }
          : img
      )
    );
    setActiveStep(1);
    setXmlOutput("");
  }, []);

  // --- Core Logic ---
  const processImages = useCallback(async () => {
    const pendingImages = uploadedImages.filter(
      (img) => img.status === "pending" || img.status === "error"
    );

    if (pendingImages.length === 0) return;

    setIsProcessing(true);
    setActiveStep(2);
    setProcessingStage("uploading");
    setProgressValue(10);

    // Simulation for UX feedback
    const progressInterval = setInterval(() => {
      setProgressValue((old) => {
        if (old >= 90) return 90;
        return old + Math.random() * 10;
      });
    }, 800);

    const stageTimers: NodeJS.Timeout[] = [];
    stageTimers.push(setTimeout(() => setProcessingStage("ocr"), 2000));
    stageTimers.push(setTimeout(() => setProcessingStage("reasoning"), 5000));
    stageTimers.push(setTimeout(() => setProcessingStage("validating"), 9000));

    let successCount = 0;

    try {
      for (const image of pendingImages) {
        setUploadedImages((prev) =>
          prev.map((img) =>
            img.id === image.id ? { ...img, status: "processing", progress: 30 } : img
          )
        );

        const formData = new FormData();
        formData.append("image", image.file);

        // API Call
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
              ? { ...img, status: "complete", progress: 100, rawText: data.rawText }
              : img
          )
        );

        setXmlOutput((prev) => (prev ? prev + "\n" + data.xml : data.xml));
        successCount++;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Error";
      setUploadedImages((prev) =>
        prev.map((img) =>
          img.id === pendingImages[0].id 
            ? { ...img, status: "error", error: errorMessage }
            : img
        )
      );
      toast({
        title: "Processing Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      clearInterval(progressInterval);
      stageTimers.forEach(clearTimeout);
      
      setIsProcessing(false);
      setProcessingStage("complete");
      setProgressValue(100);

      if (successCount > 0) {
        setTimeout(() => {
          setActiveStep(3);
          toast({
            title: "Extraction Successful",
            description: `Successfully processed ${successCount} document(s).`,
          });
        }, 800);
      }
    }
  }, [uploadedImages, toast]);

  const handleDownload = useCallback((format: 'xml' | 'csv') => {
    if (!xmlOutput) return;

    if (format === 'xml') {
      downloadFile(xmlOutput, "RxSync_Medical_Data.xml", "application/xml");
      toast({ title: "Download Started", description: "XML file saved to your device." });
    } else {
      const csvContent = convertXmlToCsv(xmlOutput);
      if (!csvContent) {
        toast({ title: "Error", description: "Failed to convert to CSV.", variant: "destructive" });
        return;
      }
      downloadFile(csvContent, "RxSync_Medical_Data.csv", "text/csv");
      toast({ title: "Download Started", description: "CSV file saved to your device." });
    }
  }, [xmlOutput, toast]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(xmlOutput);
    toast({ title: "Copied", description: "XML copied to clipboard." });
  };

  const hasImages = uploadedImages.length > 0;
  const hasPending = uploadedImages.some(i => i.status === "pending");
  const fullRawText = uploadedImages.map(i => i.rawText || "").join("\n\n--- Next Document ---\n\n");

  return (
    // Changed "slate" to "zinc" for neutral gray/black dark mode
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 font-sans transition-colors duration-300">
      
      {/* 1. Header Section */}
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div 
              whileHover={{ rotate: 10, scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="bg-blue-600 p-2 rounded-lg shadow-lg shadow-blue-600/20 cursor-pointer"
            >
              <Activity className="w-5 h-5 text-white" />
            </motion.div>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white leading-none">
                RxSync
              </h1>
              {/* MODIFIED: Separated text and link, added Italics */}
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400 font-semibold mt-0.5 flex items-center gap-1">
                Built by 
                <a 
                  href="https://juaraitsolutions.com/" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-500 italic hover:underline flex items-center gap-1 transition-all"
                >
                  Juara IT Solutions <ExternalLink className="w-2 h-2" />
                </a>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10 space-y-12">
        
        {/* 2. Progress Stepper */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-4 text-sm font-medium">
            <StepIndicator step={1} current={activeStep} label="Upload" />
            <div className={`w-16 h-0.5 transition-all duration-500 ease-in-out ${activeStep > 1 ? "bg-blue-600 dark:bg-blue-500" : "bg-zinc-200 dark:bg-zinc-800"}`} />
            <StepIndicator step={2} current={activeStep} label="Processing" />
            <div className={`w-16 h-0.5 transition-all duration-500 ease-in-out ${activeStep > 2 ? "bg-blue-600 dark:bg-blue-500" : "bg-zinc-200 dark:bg-zinc-800"}`} />
            <StepIndicator step={3} current={activeStep} label="Results" />
          </div>
        </div>

        {/* 3. Main Content Area */}
        <AnimatePresence mode="wait">
          
          {/* STEP 1: UPLOAD */}
          {activeStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="space-y-8"
            >
              <div className="text-center space-y-3 max-w-2xl mx-auto">
                <h2 className="text-3xl font-bold text-zinc-900 dark:text-white tracking-tight">Upload Medical Records</h2>
                <p className="text-zinc-500 dark:text-zinc-400 text-lg">
                  Drag & drop pharmacy orders or clinical notes to extract structured XML data.
                </p>
              </div>

              {/* ENHANCED: Hover effect on Card */}
              <Card className="border-zinc-200 dark:border-zinc-800 shadow-sm bg-white dark:bg-zinc-900 overflow-hidden transition-all duration-500 hover:shadow-xl hover:border-blue-500/20 group">
                <CardContent className="p-8 space-y-8">
                  <ImageUploadZone 
                    onFilesSelected={handleFilesSelected} 
                    disabled={isProcessing} 
                  />
                  
                  {hasImages && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                          <FileText className="w-4 h-4 text-blue-500" />
                          Selected Documents ({uploadedImages.length})
                        </h3>
                        <Button 
                          onClick={processImages} 
                          disabled={!hasPending}
                          className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 transition-all hover:scale-105 active:scale-95"
                        >
                          <Play className="w-4 h-4 mr-2" />
                          Process Documents
                        </Button>
                      </div>
                      <ImagePreviewGrid 
                        images={uploadedImages} 
                        onRemove={handleRemoveImage} 
                        disabled={isProcessing} 
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* STEP 2: PROCESSING */}
          {activeStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.4 }}
              className="max-w-2xl mx-auto"
            >
              <Card className="border-zinc-200 dark:border-zinc-800 shadow-2xl bg-white dark:bg-zinc-900 relative overflow-hidden ring-1 ring-zinc-950/5 dark:ring-white/5">
                {/* Progress Bar */}
                <div className="absolute top-0 left-0 w-full h-1.5 bg-zinc-100 dark:bg-zinc-800">
                  <motion.div 
                    className="h-full bg-blue-600 dark:bg-blue-500 shadow-[0_0_10px_rgba(37,99,235,0.5)]"
                    initial={{ width: "0%" }}
                    animate={{ width: `${progressValue}%` }}
                    transition={{ ease: "linear" }}
                  />
                </div>

                <CardContent className="p-12 flex flex-col items-center text-center space-y-10">
                  <div className="relative">
                    <div className="absolute inset-0 bg-blue-100 dark:bg-blue-500/10 rounded-full animate-ping opacity-50" />
                    <div className="bg-blue-50 dark:bg-zinc-800 p-6 rounded-full relative z-10 border border-blue-100 dark:border-zinc-700 shadow-inner">
                      <Loader2 className="w-10 h-10 text-blue-600 dark:text-blue-400 animate-spin" />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-2xl font-semibold text-zinc-900 dark:text-white">
                      AI Extraction in Progress
                    </h3>
                    <AnimatePresence mode="wait">
                      <motion.p 
                        key={processingStage}
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        className="text-zinc-500 dark:text-zinc-400 font-medium h-5"
                      >
                        {STAGE_MESSAGES[processingStage]}
                      </motion.p>
                    </AnimatePresence>
                  </div>

                  {/* Status Steps */}
                  <div className="w-full max-w-sm space-y-4 text-left bg-zinc-50 dark:bg-zinc-950/50 p-6 rounded-xl border border-zinc-100 dark:border-zinc-800">
                    <StatusItem label="Upload & Encryption" status={progressValue > 10 ? 'done' : 'active'} />
                    <StatusItem label="OCR Layout Analysis" status={progressValue > 30 ? 'done' : (progressValue > 10 ? 'active' : 'pending')} />
                    <StatusItem label="Clinical Entity Reasoning" status={progressValue > 60 ? 'done' : (progressValue > 30 ? 'active' : 'pending')} />
                    <StatusItem label="XML Schema Validation" status={progressValue > 90 ? 'done' : (progressValue > 60 ? 'active' : 'pending')} />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* STEP 3: RESULTS */}
          {activeStep === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-8"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm hover:shadow-md transition-all duration-300">
                <div>
                  <h2 className="text-2xl font-bold text-zinc-900 dark:text-white flex items-center gap-3">
                    <CheckCircle2 className="w-7 h-7 text-green-500" />
                    Extraction Complete
                  </h2>
                  <p className="text-zinc-500 dark:text-zinc-400 mt-1">
                    Your data has been successfully normalized and converted.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={handleRetry} className="text-zinc-700 dark:text-zinc-300 border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all hover:scale-105">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    New Batch
                  </Button>
                  
                  {/* Download Dropdown */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 transition-all hover:scale-105 active:scale-95">
                        <Download className="w-4 h-4 mr-2" />
                        Download Results
                        <ChevronDown className="w-4 h-4 ml-2 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="dark:bg-zinc-900 dark:border-zinc-800 animate-in fade-in zoom-in-95 duration-200">
                      <DropdownMenuItem onClick={() => handleDownload('xml')} className="cursor-pointer dark:hover:bg-zinc-800 focus:bg-blue-50 dark:focus:bg-zinc-800">
                        <FileCode2 className="w-4 h-4 mr-2 text-blue-500" />
                        Download as XML
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDownload('csv')} className="cursor-pointer dark:hover:bg-zinc-800 focus:bg-blue-50 dark:focus:bg-zinc-800">
                        <FileType className="w-4 h-4 mr-2 text-green-500" />
                        Download as CSV
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="grid lg:grid-cols-3 gap-8">
                {/* Result Viewer (XML & Raw Text Tabs) */}
                <Card className="lg:col-span-2 border-zinc-200 dark:border-zinc-800 shadow-md bg-white dark:bg-zinc-900 flex flex-col overflow-hidden transition-all hover:shadow-xl hover:border-blue-500/10">
                  <Tabs defaultValue="xml" className="flex flex-col flex-1">
                    <CardHeader className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/30 py-2 px-6 flex flex-row items-center justify-between">
                      <TabsList className="bg-zinc-200/50 dark:bg-zinc-800">
                        <TabsTrigger value="xml" className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm">Structured XML</TabsTrigger>
                        <TabsTrigger value="raw" className="data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:shadow-sm">Raw OCR Text</TabsTrigger>
                      </TabsList>
                      <Button variant="ghost" size="sm" onClick={copyToClipboard} className="text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all active:scale-95">
                        <Copy className="w-4 h-4 mr-2" /> Copy
                      </Button>
                    </CardHeader>
                    
                    <CardContent className="p-0 flex-1 relative group min-h-[500px]">
                      <TabsContent value="xml" className="m-0 h-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <pre className="p-6 h-[500px] overflow-auto text-xs font-mono leading-relaxed text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-950/50 selection:bg-blue-100 dark:selection:bg-blue-900 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                          {xmlOutput}
                        </pre>
                      </TabsContent>
                      <TabsContent value="raw" className="m-0 h-full animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <pre className="p-6 h-[500px] overflow-auto text-xs font-mono leading-relaxed text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950 selection:bg-blue-100 dark:selection:bg-blue-900 scrollbar-thin scrollbar-thumb-zinc-200 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent">
                          {fullRawText}
                        </pre>
                      </TabsContent>
                    </CardContent>
                  </Tabs>
                </Card>

                {/* Summary / Stats Panel */}
                <Card className="border-zinc-200 dark:border-zinc-800 shadow-md bg-white dark:bg-zinc-900 h-fit transition-all hover:shadow-lg hover:-translate-y-1">
                  <CardHeader>
                    <CardTitle className="text-sm font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Batch Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800">
                      <span className="text-sm text-zinc-600 dark:text-zinc-400">Files Processed</span>
                      <span className="font-mono font-bold text-zinc-900 dark:text-white bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">{uploadedImages.length}</span>
                    </div>
                    <div className="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-800">
                      <span className="text-sm text-zinc-600 dark:text-zinc-400">Status</span>
                      <span className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm font-bold">
                        <CheckCircle2 className="w-4 h-4" /> Success
                      </span>
                    </div>
                    <div className="pt-2">
                      <div className="bg-blue-50 dark:bg-zinc-800/50 border border-blue-100 dark:border-zinc-700 rounded-lg p-4 text-xs text-blue-700 dark:text-zinc-300 leading-relaxed">
                        <strong>Quality Check:</strong> Ensure all extracted dosages match the original prescription image before importing into EMR systems.
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 mt-12 bg-white dark:bg-zinc-900 py-8 transition-colors duration-300">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center md:text-left">
            &copy; 2025 RxSync. All rights reserved.
          </p>
          {/* MODIFIED: Separated text and link, added Italics */}
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
            Powered by 
            <a 
              href="https://juaraitsolutions.com/" 
              target="_blank" 
              rel="noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 italic hover:underline flex items-center gap-1 transition-colors"
            >
              Juara IT Solutions <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

// --- Visual Components ---

function StepIndicator({ step, current, label }: { step: number; current: number; label: string }) {
  const isActive = current >= step;
  const isCurrent = current === step;
  
  return (
    <div className={`flex items-center gap-3 transition-all duration-300 ${isActive ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-600"}`}>
      <div 
        className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all duration-300 shadow-sm
          ${isCurrent ? "border-blue-600 bg-blue-600 text-white scale-110 shadow-blue-600/30" : 
            isActive ? "border-blue-600 bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-500" : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600"}
        `}
      >
        {isActive && !isCurrent ? <CheckCircle2 className="w-5 h-5 animate-in zoom-in duration-200" /> : <span className="font-bold text-sm">{step}</span>}
      </div>
      <span className={`${isCurrent ? "font-bold" : "font-medium"}`}>{label}</span>
    </div>
  );
}

function StatusItem({ label, status }: { label: string; status: 'pending' | 'active' | 'done' }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
        status === 'done' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 
        status === 'active' ? 'bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)] scale-125' : 'bg-zinc-200 dark:bg-zinc-700'
      }`} />
      <span className={`text-sm transition-colors duration-300 ${
        status === 'active' ? 'text-zinc-900 dark:text-white font-semibold' : 'text-zinc-500 dark:text-zinc-500'
      }`}>
        {label}
      </span>
    </div>
  );
}