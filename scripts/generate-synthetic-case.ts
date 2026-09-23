import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SEED = 20260922;
const GENERATED_FILES = [
  "historical-deals.csv",
  "current-prospects.csv",
  "leadbay-state.json",
] as const;

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function csv(
  headers: string[],
  rows: Array<Record<string, string | number | boolean | null>>,
): string {
  return `${[
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header] ?? null)).join(",")),
  ].join("\r\n")}\r\n`;
}

function monthlyDate(position: number): string {
  const monthIndex = position;
  const year = 2019 + Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-15`;
}

const HISTORY_HEADERS = [
  "CRM Record ID",
  "Account Name",
  "Company Website",
  "Primary Contact Email",
  "Location",
  "Deal Result",
  "Loss Reason",
  "Close Date",
  "Sales Motion",
  "Customer Base",
  "Commercial Systems",
  "Employee Count",
  "Recent Funding",
  "Warehouse Network",
  "Legal Status",
  "Deal Stage",
  "Win Probability",
  "Forecast Category",
  "Final Sales Notes",
];

const PROSPECT_HEADERS = [
  "CRM Record ID",
  "Account Name",
  "Company Website",
  "Primary Contact Email",
  "Location",
  "Sales Motion",
  "Customer Base",
  "Commercial Systems",
  "Employee Count",
  "Recent Funding",
  "Warehouse Network",
  "Legal Status",
];

function websiteFor(domain: string, index: number): string {
  if (index % 11 === 0) return "";
  if (index % 4 === 0) return ` HTTPS://WWW.${domain.toUpperCase()}:443/catalog `;
  if (index % 4 === 1) return `http://${domain}/about`;
  if (index % 4 === 2) return `www.${domain}`;
  return domain;
}

function historyRows(): Array<Record<string, string | number | boolean | null>> {
  const random = mulberry32(SEED);
  const rows: Array<Record<string, string | number | boolean | null>> = [];
  const locations = ["Dallas, TX", "Denver, CO", "Tulsa, OK", "Phoenix, AZ", "Columbus, OH"];
  let singleton = 0;

  for (let position = 0; position < 80; position++) {
    const warehouseGroup = position >= 5 && position < 15;
    const companyIndex = warehouseGroup ? -1 : singleton++;
    const companyNumber = companyIndex + 1;
    const combo = warehouseGroup ? 7 : companyIndex % 8;
    const fieldSales = warehouseGroup || (combo & 1) !== 0;
    const fragmentedSmb = warehouseGroup || (combo & 2) !== 0;
    const crmExportable = warehouseGroup || (combo & 4) !== 0;
    const enterpriseScale = !warehouseGroup && companyIndex % 5 === 0;
    const deterministicNoise = (random() - 0.5) * 1.4;
    const score =
      1.6 * Number(fieldSales) +
      1.3 * Number(fragmentedSmb) +
      1.1 * Number(crmExportable) -
      1.4 * Number(enterpriseScale) +
      deterministicNoise;
    const outcome = warehouseGroup || score >= 1.55 ? "Won" : "Lost";
    const inactive = outcome === "Lost" && !warehouseGroup && companyIndex % 17 === 0;
    const domain = warehouseGroup
      ? "central-warehouse.example"
      : `regional-supplier-${String(companyNumber).padStart(2, "0")}.example`;
    const website = warehouseGroup ? websiteFor(domain, 2) : websiteFor(domain, companyIndex);
    const email = website
      ? companyIndex % 13 === 0
        ? `buyer${companyNumber}@gmail.com`
        : `sales${companyNumber}@${domain}`
      : companyIndex % 11 === 0
        ? `owner${companyNumber}@gmail.com`
        : `commercial${companyNumber}@${domain}`;
    const recentFunding =
      position < 60 && position % 3 !== 0 ? "" : position % 2 === 0 ? "true" : "false";
    const salesMotion = fieldSales
      ? position % 2 === 0
        ? " Field sales "
        : "Territory sales"
      : position % 2 === 0
        ? "Inside sales"
        : "Founder led";
    const customerBase = fragmentedSmb
      ? position % 2 === 0
        ? "Fragmented SMB"
        : "Local business network"
      : position % 2 === 0
        ? "Enterprise accounts"
        : "Consumer mass market";
    const commercialSystems = crmExportable
      ? position % 3 === 0
        ? "Salesforce CRM"
        : position % 3 === 1
          ? "HubSpot CRM and ERP export"
          : "Microsoft Dynamics ERP"
      : position % 2 === 0
        ? "Spreadsheets"
        : "Email only";
    const employeeCount = enterpriseScale
      ? 1200 + (companyIndex % 4) * 300
      : 35 + ((Math.max(companyIndex, 0) * 37) % 760);
    const recordId = warehouseGroup
      ? `WH-${String(position - 4).padStart(2, "0")}`
      : `D-${String(companyNumber).padStart(3, "0")}`;
    const accountName = warehouseGroup
      ? "Central Builders Warehouse Network"
      : `Regional Supply Company ${String(companyNumber).padStart(2, "0")}`;
    let location: string;
    if (warehouseGroup) {
      location = "Kansas City, MO";
    } else {
      const locationIndex = companyIndex % locations.length;
      const fallbackLocation = locations.at(locationIndex);
      if (fallbackLocation === undefined) {
        throw new Error(`Synthetic location index ${locationIndex} is unavailable.`);
      }
      location = fallbackLocation;
    }
    const won = outcome === "Won";
    rows.push({
      "CRM Record ID": recordId,
      "Account Name": accountName,
      "Company Website": website,
      "Primary Contact Email": email,
      Location: location,
      "Deal Result": outcome,
      "Loss Reason": won
        ? ""
        : companyIndex % 2 === 0
          ? "No territory fit"
          : "Low sales-system maturity",
      "Close Date": monthlyDate(position),
      "Sales Motion": salesMotion,
      "Customer Base": customerBase,
      "Commercial Systems": commercialSystems,
      "Employee Count": employeeCount,
      "Recent Funding": recentFunding,
      "Warehouse Network": warehouseGroup ? "true" : "false",
      "Legal Status": inactive ? "Inactive" : "Active",
      "Deal Stage": won ? "Closed Won" : "Closed Lost",
      "Win Probability": won ? 100 : 0,
      "Forecast Category": won ? "Commit" : "Omitted",
      "Final Sales Notes": won ? "Synthetic order completed" : "Synthetic opportunity closed",
    });
  }

  const duplicateSource = rows.at(24);
  if (duplicateSource === undefined) {
    throw new Error("Synthetic duplicate source row 25 is unavailable.");
  }
  const duplicate = { ...duplicateSource };
  rows.splice(25, 0, duplicate);

  const unique = new Map<string, Record<string, string | number | boolean | null>>();
  for (const row of rows) unique.set(String(row["CRM Record ID"]), row);
  const uniqueRows = [...unique.values()];
  const wins = uniqueRows.filter((row) => row["Deal Result"] === "Won").length;
  const losses = uniqueRows.length - wins;
  const holdout = uniqueRows.filter((row) => String(row["Close Date"]) >= monthlyDate(60));
  const holdoutWins = holdout.filter((row) => row["Deal Result"] === "Won").length;
  const holdoutLosses = holdout.length - holdoutWins;
  const missingRecentFundingTraining = uniqueRows.filter(
    (row) => String(row["Close Date"]) < monthlyDate(60) && row["Recent Funding"] === "",
  ).length;
  const inactiveWins = uniqueRows.filter(
    (row) => row["Deal Result"] === "Won" && row["Legal Status"] !== "Active",
  );
  if (
    uniqueRows.length !== 80 ||
    wins < 12 ||
    losses < 12 ||
    holdoutWins < 5 ||
    holdoutLosses < 5 ||
    missingRecentFundingTraining < 36 ||
    inactiveWins.length !== 0
  ) {
    throw new Error(
      `Synthetic distribution invariant failed: rows=${uniqueRows.length}, wins=${wins}, losses=${losses}, holdout=${holdoutWins}/${holdoutLosses}, recent_missing=${missingRecentFundingTraining}, inactive_wins=${inactiveWins.length}`,
    );
  }
  return rows;
}

function prospectRows(): Array<Record<string, string | number | boolean | null>> {
  return [
    {
      "CRM Record ID": "P-STRONG",
      "Account Name": "Summit Territory Supply",
      "Company Website": "https://www.summit-territory.example/",
      "Primary Contact Email": "sales@summit-territory.example",
      Location: "Denver, CO",
      "Sales Motion": "Territory sales",
      "Customer Base": "Fragmented SMB",
      "Commercial Systems": "Salesforce CRM and NetSuite ERP",
      "Employee Count": 280,
      "Recent Funding": "false",
      "Warehouse Network": "true",
      "Legal Status": "Active",
    },
    {
      "CRM Record ID": "P-PARTIAL",
      "Account Name": "Prairie Contractor Services",
      "Company Website": "prairie-contractor.example",
      "Primary Contact Email": "hello@prairie-contractor.example",
      Location: "Tulsa, OK",
      "Sales Motion": "Field sales",
      "Customer Base": "",
      "Commercial Systems": "HubSpot CRM",
      "Employee Count": 95,
      "Recent Funding": "",
      "Warehouse Network": "false",
      "Legal Status": "Active",
    },
    {
      "CRM Record ID": "P-CONSUMER",
      "Account Name": "Independent Remodeler Collective",
      "Company Website": "",
      "Primary Contact Email": "owner@gmail.com",
      Location: "Phoenix, AZ",
      "Sales Motion": "Field sales",
      "Customer Base": "Local business network",
      "Commercial Systems": "Spreadsheets",
      "Employee Count": 20,
      "Recent Funding": "",
      "Warehouse Network": "false",
      "Legal Status": "Active",
    },
    {
      "CRM Record ID": "P-WEAK",
      "Account Name": "Single Site Retail Outlet",
      "Company Website": "single-site-retail.example",
      "Primary Contact Email": "contact@single-site-retail.example",
      Location: "Columbus, OH",
      "Sales Motion": "Inside sales",
      "Customer Base": "Consumer mass market",
      "Commercial Systems": "Email only",
      "Employee Count": 45,
      "Recent Funding": "false",
      "Warehouse Network": "false",
      "Legal Status": "Active",
    },
    {
      "CRM Record ID": "P-INACTIVE",
      "Account Name": "Dormant Regional Distributor",
      "Company Website": "dormant-distributor.example",
      "Primary Contact Email": "sales@dormant-distributor.example",
      Location: "Dallas, TX",
      "Sales Motion": "Territory sales",
      "Customer Base": "Fragmented SMB",
      "Commercial Systems": "Dynamics ERP and CRM",
      "Employee Count": 310,
      "Recent Funding": "true",
      "Warehouse Network": "true",
      "Legal Status": "Inactive",
    },
  ];
}

function compactPrimitiveJsonArrays(json: string, lineWidth = 100): string {
  const lines = json.split("\n");
  const output: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const opening = lines.at(index);
    if (opening === undefined) break;
    if (!opening.endsWith("[")) {
      output.push(opening);
      continue;
    }

    const indent = opening.slice(0, opening.search(/\S|$/));
    const values: string[] = [];
    let closingIndex = index + 1;
    let closingSuffix: string | undefined;
    for (; closingIndex < lines.length; closingIndex++) {
      const line = lines.at(closingIndex);
      if (line === undefined) break;
      if (line === `${indent}]` || line === `${indent}],`) {
        closingSuffix = line.endsWith(",") ? "," : "";
        break;
      }
      const item = line.trim().replace(/,$/, "");
      try {
        const parsed = JSON.parse(item) as unknown;
        if (parsed !== null && typeof parsed === "object") {
          closingSuffix = undefined;
          break;
        }
      } catch {
        closingSuffix = undefined;
        break;
      }
      values.push(item);
    }

    if (closingSuffix !== undefined && values.length > 0) {
      const inline = `${opening}${values.join(", ")}]${closingSuffix}`;
      if (inline.length <= lineWidth) {
        output.push(inline);
        index = closingIndex;
        continue;
      }
    }
    output.push(opening);
  }
  return output.join("\n");
}

function stateJson(): string {
  return `${compactPrimitiveJsonArrays(
    JSON.stringify(
      {
        schema_version: "1.0",
        region: "us",
        user: {
          id: "synthetic-user",
          admin: true,
          organization: { id: 4242, name: "Northstar Building Supply" },
        },
        qualification_questions: [
          {
            question: "Is the company likely to sell through a repeatable B2B sales process?",
            lang: "en",
          },
          {
            question: "Is the company likely to have a dedicated commercial team?",
            lang: "en",
          },
        ],
        ideal_buyer_profile: {
          summary: "Regional B2B suppliers and contractors",
          key_characteristics: ["B2B", "repeat purchase potential"],
          anti_patterns: ["Consumer-only retailers"],
        },
        targeting_prompt: "Prioritize regional business suppliers serving contractors.",
      },
      null,
      2,
    ),
  )}\n`;
}

export function buildGeneratedFiles(): Record<(typeof GENERATED_FILES)[number], string> {
  return {
    "historical-deals.csv": csv(HISTORY_HEADERS, historyRows()),
    "current-prospects.csv": csv(PROSPECT_HEADERS, prospectRows()),
    "leadbay-state.json": stateJson(),
  };
}

export function writeSyntheticCase(caseDir: string): void {
  mkdirSync(caseDir, { recursive: true });
  const files = buildGeneratedFiles();
  for (const name of GENERATED_FILES) writeFileSync(join(caseDir, name), files[name], "utf8");
}

export function checkSyntheticCase(caseDir: string): string[] {
  const temp = mkdtempSync(join(tmpdir(), "leadbay-synthetic-check-"));
  try {
    writeSyntheticCase(temp);
    return GENERATED_FILES.filter((name) => {
      const committed = join(caseDir, name);
      return (
        !existsSync(committed) ||
        readFileSync(committed, "utf8") !== readFileSync(join(temp, name), "utf8")
      );
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function runGenerator(args: string[] = process.argv.slice(2)): number {
  const caseDir = resolve(process.cwd(), "fixtures", "building-materials-distributor");
  if (args.includes("--write")) {
    writeSyntheticCase(caseDir);
    return 0;
  }
  if (args.includes("--check")) {
    const drift = checkSyntheticCase(caseDir);
    if (drift.length > 0) {
      console.error(`Synthetic fixture drift: ${drift.join(", ")}`);
      return 1;
    }
    return 0;
  }
  console.error("Usage: generate-synthetic-case.ts --write | --check");
  return 64;
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) process.exitCode = runGenerator();
