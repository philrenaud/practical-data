/**
 * The few Apps Script services the add-on uses, declared here instead of
 * depending on @types/google-apps-script.
 */

declare namespace GoogleAppsScript {
  interface Range {
    getRow(): number;
    getColumn(): number;
    getNumRows(): number;
    getNumColumns(): number;
    getA1Notation(): string;
    getDisplayValues(): string[][];
    getValues(): unknown[][];
    getDataRegion(): Range;
    getBackgrounds(): string[][];
    setBackgrounds(colors: (string | null)[][]): Range;
    getCell(row: number, col: number): Range;
    setBackground(color: string | null): Range;
  }

  interface ConditionalFormatRule {
    getRanges(): Range[];
  }

  interface ConditionalFormatRuleBuilder {
    setGradientMinpointWithValue(color: string, type: unknown, value: string): ConditionalFormatRuleBuilder;
    setGradientMidpointWithValue(color: string, type: unknown, value: string): ConditionalFormatRuleBuilder;
    setGradientMaxpointWithValue(color: string, type: unknown, value: string): ConditionalFormatRuleBuilder;
    whenTextEqualTo(text: string): ConditionalFormatRuleBuilder;
    setBackground(color: string): ConditionalFormatRuleBuilder;
    setRanges(ranges: Range[]): ConditionalFormatRuleBuilder;
    build(): ConditionalFormatRule;
  }

  interface DeveloperMetadata {
    getKey(): string;
    getValue(): string | null;
    setValue(value: string): DeveloperMetadata;
    remove(): void;
  }

  interface Sheet {
    getName(): string;
    getRange(row: number, col: number, rows: number, cols: number): Range;
    getRange(a1: string): Range;
    getConditionalFormatRules(): ConditionalFormatRule[];
    setConditionalFormatRules(rules: ConditionalFormatRule[]): void;
    getDeveloperMetadata(): DeveloperMetadata[];
    addDeveloperMetadata(key: string, value: string): Sheet;
  }

  interface Spreadsheet {
    getName(): string;
    getActiveSheet(): Sheet;
    getActiveRange(): Range | null;
    toast(message: string, title?: string, seconds?: number): void;
  }

  interface Menu {
    addItem(caption: string, functionName: string): Menu;
    addSeparator(): Menu;
    addSubMenu(menu: Menu): Menu;
    addToUi(): void;
  }

  interface Ui {
    createAddonMenu(): Menu;
    createMenu(caption: string): Menu;
    alert(message: string): unknown;
  }

  interface HTTPResponse {
    getResponseCode(): number;
    getContentText(): string;
    getHeaders(): Record<string, string>;
  }
}

declare const SpreadsheetApp: {
  getActiveSpreadsheet(): GoogleAppsScript.Spreadsheet;
  getUi(): GoogleAppsScript.Ui;
  newConditionalFormatRule(): GoogleAppsScript.ConditionalFormatRuleBuilder;
  readonly InterpolationType: { readonly NUMBER: unknown };
};

declare const PropertiesService: {
  getUserProperties(): { getProperty(key: string): string | null; setProperty(key: string, value: string): unknown };
};

declare const UrlFetchApp: {
  fetch(
    url: string,
    params: { method: "post"; contentType: string; payload: string; headers: Record<string, string>; muteHttpExceptions: boolean },
  ): GoogleAppsScript.HTTPResponse;
};

declare const Utilities: { getUuid(): string };
