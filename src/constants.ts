import type { PerkOSContracts, PerkOSNetwork } from "./types.js";

const MAINNET_DEPLOYER = "SP2K7PV5NXBNRV510S6DCA6RFMTFHAF3ZPK6ZSXPH";
const TESTNET_DEPLOYER = "ST16EWRC01S1SFWGBP63MW47VY8P3AYFA8VGEBGE5";

export const DEFAULT_DEPLOYMENTS: Readonly<Record<PerkOSNetwork, PerkOSContracts>> = {
  mainnet: {
    agentRegistry: `${MAINNET_DEPLOYER}.agent-registry`,
    stxCommerce: `${MAINNET_DEPLOYER}.agentic-commerce-v2`,
    sbtcCommerce: `${MAINNET_DEPLOYER}.sbtc-commerce`,
    reputationRegistry: `${MAINNET_DEPLOYER}.reputation-registry-v2`,
    sbtcToken: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token",
    sbtcAssetName: "sbtc-token",
  },
  testnet: {
    agentRegistry: `${TESTNET_DEPLOYER}.agent-registry`,
    stxCommerce: `${TESTNET_DEPLOYER}.agentic-commerce-v2`,
    sbtcCommerce: `${TESTNET_DEPLOYER}.sbtc-commerce`,
    reputationRegistry: `${TESTNET_DEPLOYER}.reputation-registry-v2`,
    sbtcToken: "ST1F7QA2MDF17S807EPA36TSS8AMEFY4KA9TVGWXT.sbtc-token",
    sbtcAssetName: "sbtc-token",
  },
};

export const JOB_STATUS = {
  0: "open",
  1: "funded",
  2: "submitted",
  3: "completed",
  4: "rejected",
  5: "expired",
} as const;

export const CLARITY_ERROR_MESSAGES: Readonly<Record<number, string>> = {
  100: "Only the registry owner may perform this operation.",
  101: "The caller is not authorized by the agent registry.",
  102: "Agent not found.",
  103: "Agent name is invalid.",
  104: "Agent description is invalid.",
  200: "Only the commerce owner may perform this operation.",
  201: "The caller is not authorized.",
  202: "Job not found.",
  203: "The job is not in the required state.",
  204: "The job has expired.",
  205: "The job budget is invalid.",
  207: "Only the job client may perform this operation.",
  208: "Only the assigned provider may perform this operation.",
  209: "Only the evaluator may perform this operation.",
  210: "The job was already funded.",
  212: "The job description is invalid.",
  213: "Client, provider, and evaluator must be distinct.",
  214: "This rater already rated the job.",
  215: "The rating must be between 1 and 5.",
  216: "The job has not expired.",
  300: "Only the commerce owner may perform this operation.",
  301: "The caller is not authorized.",
  302: "Job not found.",
  303: "The job is not in the required state.",
  304: "The job has expired.",
  305: "The job budget is invalid.",
  307: "Only the job client may perform this operation.",
  308: "Only the assigned provider may perform this operation.",
  309: "Only the evaluator may perform this operation.",
  310: "The job was already funded.",
  311: "The supplied payment token is not the configured sBTC token.",
  312: "The job description is invalid.",
  313: "Client, provider, and evaluator must be distinct.",
  314: "This rater already rated the job.",
  315: "The rating must be between 1 and 5.",
  316: "The job has not expired.",
  400: "Only the reputation registry owner may perform this operation.",
  401: "The caller is not an authorized protocol contract.",
  402: "The rating is invalid.",
  403: "This job was already rated.",
  404: "An agent cannot rate itself.",
};
