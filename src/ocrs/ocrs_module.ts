import {
    OcrEngine,
    OcrEngineInit,
    default as initOcrLib,
  } from "./ocrs.js";

async function fetchAsBinary(path: string): Promise<Uint8Array> {
    const response = await fetch(path)
    const data = await response.arrayBuffer()
    console.log(data)
    return new Uint8Array(data)
}

export class OcrsModule {
    private static instance: OcrsModule;
    private static status: number = -1;
    private static ocrEngine: OcrEngine | null = null;

    private constructor() {
        OcrsModule.initEngine()
    }

    private static async initEngine() {
        if (OcrsModule.status > -1) {
            return
        }
        OcrsModule.status = 0
        const wasmBinary = await fetchAsBinary("/ocrs_bg.wasm");
        console.log("Loaded wasm")
        console.log(wasmBinary.length)
        initOcrLib(wasmBinary)

        const [detectionModel, recognitionModel] = await Promise.all([
            fetchAsBinary("/text-detection-ssfbcj81.onnx"),
            fetchAsBinary("/text-rec-checkpoint-s52qdbqt.onnx"),
        ]);
        console.log("Loaded detectionModel")
        console.log(detectionModel.length)
        console.log("Loaded recognitionModel")
        console.log(recognitionModel.length)
    
        const ocrInit = new OcrEngineInit();
        ocrInit.setDetectionModel(detectionModel);
        ocrInit.setRecognitionModel(recognitionModel);
    
        OcrsModule.ocrEngine = new OcrEngine(ocrInit);
        OcrsModule.status = 1
    }

    static getInstance(): OcrsModule {
        if (!OcrsModule.instance) {
            OcrsModule.instance = new OcrsModule();
        }
        return OcrsModule.instance;
    }

    detectAndRecognizeText(image: ImageData) {
        if (!OcrsModule.ocrEngine) {
            console.log("not yet init")
            return
        }
        const ocrInput = OcrsModule.ocrEngine.loadImage(
            image.width,
            image.height,
            Uint8Array.from(image.data),
        );
        const textLines = OcrsModule.ocrEngine.getTextLines(ocrInput);
        const lines = textLines.map((line) => {
          const words = line.words().map((word) => {
            return {
              text: word.text(),
              rect: Array.from(word.rotatedRect().boundingRect()),
            };
          });
      
          return {
            text: line.text(),
            words,
          };
        });
        return {
          lines,
        };
      }
}