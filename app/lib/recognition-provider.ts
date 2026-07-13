export type RecognitionSource={assetId:number;mimeType:string;purpose:string};
export type RecognitionProviderResult={items:Array<Record<string,unknown>>;provider:string;requiresReview:true};
export interface RecognitionProvider{readonly name:string;recognize(sources:RecognitionSource[]):Promise<RecognitionProviderResult>}
export class ManualRecognitionProvider implements RecognitionProvider{readonly name="manual";async recognize(){return{items:[],provider:this.name,requiresReview:true as const}}}
export function configuredRecognitionProvider(name?:string):RecognitionProvider{if(!name||name==="manual")return new ManualRecognitionProvider();throw new Error("云识别服务尚未获得费用与隐私授权，不能发送学生资料")}

