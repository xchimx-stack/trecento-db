export const DEFAULT_STORAGE_CAPACITY_BYTES=1024*1024*1024;
export const MEDIA_STORAGE_FRACTION=0.50;

export function mediaStorageLimitBytes(){
  const capacity=Number(
    process.env.SUPABASE_STORAGE_CAPACITY_BYTES ||
    DEFAULT_STORAGE_CAPACITY_BYTES
  );
  return Math.floor(capacity*MEDIA_STORAGE_FRACTION);
}

export function canStoreMedia(currentBytes,nextBytes=0){
  return currentBytes+nextBytes <= mediaStorageLimitBytes();
}
