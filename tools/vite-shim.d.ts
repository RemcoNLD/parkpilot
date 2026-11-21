// Vervangt vite/client-typen zodat de app te typechecken is zonder `npm install`.
declare module '*.css';
interface ImportMeta { readonly env: Record<string, string | boolean | undefined> }
