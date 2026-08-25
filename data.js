/*
  Australian R&D Intelligent Directory — mock data model
  ---------------------------------------------------------------
  ALL data in this file is SYNTHETIC / ILLUSTRATIVE demo content built for a
  proof-of-concept pilot ("CRCs and NCRIS facilities working in decarbonisation").
  Organisation names follow real-world naming conventions, but relationships,
  metrics, evidence snippets and confidence levels are fabricated for the demo
  and must not be treated as factual claims about any real organisation.
  No external API, backend, or database is used — this object graph is the
  entire "database" for the demo.
*/

window.RD_DATA = (function () {

  // ---------------------------------------------------------------------
  // Taxonomy: actor types -> visual group + icon
  // Groups map to the CVD-validated categorical palette:
  //   research_performer -> blue   |  infrastructure -> aqua
  //   industry_gov        -> orange |  concept         -> neutral (shape-coded)
  // ---------------------------------------------------------------------
  const TYPE_META = {
    crc:                  { label: "CRC",                         group: "research_performer", icon: "ic-crc" },
    university:           { label: "University",                  group: "research_performer", icon: "ic-university" },
    research_institute:   { label: "Research Institute",           group: "research_performer", icon: "ic-university" },
    ncris_facility:       { label: "NCRIS Facility",               group: "infrastructure",      icon: "ic-facility" },
    technology_precinct:  { label: "Technology Precinct",          group: "infrastructure",      icon: "ic-precinct" },
    industry_partner:     { label: "Industry Partner",             group: "industry_gov",         icon: "ic-industry" },
    government_agency:    { label: "Government Agency",            group: "industry_gov",         icon: "ic-gov" },
    incubator_accelerator:{ label: "Incubator / Accelerator",      group: "industry_gov",         icon: "ic-incubator" },
    research_theme:       { label: "Research Theme",               group: "concept",              icon: "ic-theme" },
    project_initiative:   { label: "Project / Initiative",         group: "concept",              icon: "ic-project" },
  };

  const RELATIONSHIP_META = {
    collaborates_with:        { label: "Collaborates with" },
    funded_by:                { label: "Funded by" },
    hosted_by:                { label: "Hosted by" },
    provides_infrastructure_to:{ label: "Provides infrastructure to" },
    supports_sector:          { label: "Supports sector" },
    shares_research_theme:    { label: "Shares research theme" },
    located_in_precinct:      { label: "Located in precinct" },
    industry_partner_of:      { label: "Industry partner of" },
    potential_connection:     { label: "Potential connection" },
  };

  const CONFIDENCE_META = {
    verified:        { label: "Verified",              rank: 4 },
    "public-source": { label: "Public source",         rank: 3 },
    inferred:        { label: "Inferred relationship",  rank: 2 },
    "needs-review":  { label: "Needs review",           rank: 1 },
    stale:           { label: "Stale",                  rank: 0 },
  };

  const STATES = [
    { code: "NSW", name: "New South Wales" },
    { code: "VIC", name: "Victoria" },
    { code: "QLD", name: "Queensland" },
    { code: "WA",  name: "Western Australia" },
    { code: "SA",  name: "South Australia" },
    { code: "TAS", name: "Tasmania" },
    { code: "NT",  name: "Northern Territory" },
    { code: "ACT", name: "Australian Capital Territory" },
  ];

  // ---------------------------------------------------------------------
  // Actors (organisations, facilities, precincts) + first-class Theme
  // and Project/Initiative nodes. All appear in the ecosystem network graph.
  // ---------------------------------------------------------------------
  const actors = [
    {
      id: "hilt-crc", name: "Heavy Industry Low-carbon Transition CRC", type: "crc", state: "VIC",
      sectors: ["Manufacturing"], themes: ["decarbonisation", "industrial-heat", "advanced-manufacturing"],
      summary: "Illustrative CRC coordinating heavy-industry decarbonisation research across steel, cement and aluminium value chains.",
      hostOrPartners: "Lead host: consortium of manufacturers and universities (illustrative)",
      activeInitiatives: ["Low-carbon industrial heat pilots", "Steel value-chain emissions mapping"],
      industryPartners: ["pilbara-cluster"],
      relatedFacilities: ["anff"],
      collaborationSignal: "high",
      chiefScientist: "Prof. A. Ibrahim, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "VIC", city: "Melbourne", focus: "Corporate governance and cross-sector program coordination (illustrative)." },
        { role: "branch", state: "WA", city: "Perth", focus: "Pilbara heavy-industry pilot liaison (illustrative)." },
      ],
      dataConfidence: "public-source", lastUpdated: "2026-03-04",
      sourceNotes: ["CRC public program page (illustrative)"],
      evidenceSnippet: "Public program materials describe a national heavy-industry decarbonisation focus.",
    },
    {
      id: "fbi-crc", name: "Future Battery Industries CRC", type: "crc", state: "WA",
      sectors: ["Manufacturing", "Critical Minerals"], themes: ["battery-storage", "battery-recycling", "critical-minerals"],
      summary: "Illustrative CRC building an end-to-end Australian battery industry, from mineral processing to cell manufacturing and recycling.",
      hostOrPartners: "Lead host: university and industry consortium (illustrative)",
      activeInitiatives: ["Battery Recycling Pilot Program", "Cathode precursor pilot line"],
      industryPartners: ["pilbara-cluster"],
      relatedFacilities: ["anff", "pawsey"],
      collaborationSignal: "high",
      chiefScientist: "Prof. L. Chen, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "WA", city: "Perth", focus: "Battery industry program leadership and mineral-processing partnerships (illustrative)." },
        { role: "branch", state: "SA", city: "Adelaide", focus: "Cathode precursor pilot line at Tonsley Innovation District (illustrative)." },
      ],
      dataConfidence: "verified", lastUpdated: "2026-05-18",
      sourceNotes: ["CRC public directory entry (illustrative)"],
      evidenceSnippet: "Program scope statement lists battery manufacturing and recycling as core themes.",
    },
    {
      id: "co2crc", name: "CO2CRC", type: "crc", state: "VIC",
      sectors: ["Energy", "Carbon Management"], themes: ["carbon-capture", "decarbonisation"],
      summary: "Illustrative CRC focused on carbon capture, utilisation and storage research and field trials.",
      hostOrPartners: "Lead host: research consortium with energy-sector partners (illustrative)",
      activeInitiatives: ["Onshore CO2 storage field trial", "Capture-cost reduction program"],
      industryPartners: ["pilbara-cluster"],
      relatedFacilities: [],
      collaborationSignal: "medium",
      chiefScientist: "Dr. M. Fitzgerald, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "VIC", city: "Melbourne", focus: "Carbon capture research program leadership and field-trial coordination (illustrative)." },
      ],
      dataConfidence: "public-source", lastUpdated: "2025-11-22",
      sourceNotes: ["CRC public technical reports (illustrative)"],
      evidenceSnippet: "Technical reports describe field-scale CO2 storage trials in southeastern Australia.",
    },
    {
      id: "race2030-crc", name: "RACE for 2030 CRC", type: "crc", state: "NSW",
      sectors: ["Energy"], themes: ["grid-integration", "decarbonisation", "climate-adaptation"],
      summary: "Illustrative CRC researching reliable, affordable, clean energy transitions for households, businesses and communities.",
      hostOrPartners: "Lead host: multi-university and utility consortium (illustrative)",
      activeInitiatives: ["Distributed energy resource integration studies", "Regional net-zero pathways"],
      industryPartners: [],
      relatedFacilities: ["nci"],
      collaborationSignal: "medium",
      chiefScientist: "Prof. S. Kaur, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "NSW", city: "Sydney", focus: "Multi-university consortium coordination and utility partnerships (illustrative)." },
        { role: "branch", state: "QLD", city: "Brisbane", focus: "Regional net-zero pathways research stream (illustrative)." },
      ],
      dataConfidence: "verified", lastUpdated: "2026-01-30",
      sourceNotes: ["CRC public program summaries (illustrative)"],
      evidenceSnippet: "Program summaries reference grid-integration and community energy-transition research streams.",
    },
    {
      id: "anff", name: "Australian National Fabrication Facility", type: "ncris_facility", state: "ACT",
      sectors: ["Manufacturing", "Materials"], themes: ["advanced-manufacturing", "battery-storage", "hydrogen-storage"],
      summary: "Illustrative national fabrication network providing shared micro/nano-fabrication infrastructure to researchers and industry.",
      capability: "Micro- and nano-fabrication, materials prototyping across a distributed national node network.",
      accessModel: "Fee-for-service and merit-based access across partner nodes (illustrative).",
      relatedFacilities: [],
      dataConfidence: "verified", lastUpdated: "2026-04-02",
      sourceNotes: ["NCRIS capability directory (illustrative)"],
      evidenceSnippet: "Capability listing shows fabrication support for battery and hydrogen materials research.",
    },
    {
      id: "nci", name: "National Computational Infrastructure", type: "ncris_facility", state: "ACT",
      sectors: ["Digital Infrastructure"], themes: ["research-translation", "grid-integration", "digital-infrastructure"],
      summary: "Illustrative national high-performance computing facility supporting large-scale modelling and simulation.",
      capability: "High-performance computing and large-scale data services for research modelling workloads.",
      accessModel: "Allocation scheme via national merit and partner-share access (illustrative).",
      relatedFacilities: [],
      dataConfidence: "public-source", lastUpdated: "2025-09-14",
      sourceNotes: ["NCRIS facility profile (illustrative)"],
      evidenceSnippet: "Facility profile lists grid-modelling and climate-simulation workloads among its users.",
    },
    {
      id: "pawsey", name: "Pawsey Supercomputing Research Centre", type: "ncris_facility", state: "WA",
      sectors: ["Digital Infrastructure", "Critical Minerals"], themes: ["critical-minerals", "research-translation", "digital-infrastructure"],
      summary: "Illustrative supercomputing centre supporting resources, energy and radio-astronomy research workloads.",
      capability: "Supercomputing, data storage and visualisation for resource and minerals-processing modelling.",
      accessModel: "Merit allocation and partner-share access (illustrative).",
      relatedFacilities: [],
      dataConfidence: "public-source", lastUpdated: "2025-12-01",
      sourceNotes: ["NCRIS facility profile (illustrative)"],
      evidenceSnippet: "Facility profile references minerals-processing simulation workloads from WA research users.",
    },
    {
      id: "csiro-energy", name: "CSIRO Energy", type: "government_agency", state: "ACT",
      sectors: ["Energy"], themes: ["decarbonisation", "hydrogen-storage", "industrial-heat"],
      summary: "Illustrative national science agency business unit researching low-emissions energy technologies.",
      hostOrPartners: "Commonwealth science agency (illustrative representation for demo purposes).",
      activeInitiatives: ["Hydrogen storage materials research", "Industrial heat electrification studies"],
      industryPartners: [],
      relatedFacilities: ["anff"],
      collaborationSignal: "high",
      chiefScientist: "Dr. R. Thompson, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "ACT", city: "Canberra", focus: "National low-emissions energy research portfolio leadership (illustrative)." },
        { role: "branch", state: "WA", city: "Perth", focus: "Hydrogen storage pilot integration with WA industry (illustrative)." },
      ],
      dataConfidence: "verified", lastUpdated: "2026-06-10",
      sourceNotes: ["Public research portfolio pages (illustrative)"],
      evidenceSnippet: "Public portfolio pages list hydrogen storage and industrial decarbonisation research streams.",
    },
    {
      id: "anu-eci", name: "ANU Energy Change Institute", type: "university", state: "ACT",
      sectors: ["Energy"], themes: ["grid-integration", "decarbonisation"],
      summary: "Illustrative university research institute coordinating cross-disciplinary energy-transition research.",
      hostOrPartners: "Host: Australian National University (illustrative).",
      activeInitiatives: ["ANU Battery Storage and Grid Integration Program"],
      industryPartners: [],
      relatedFacilities: ["nci"],
      collaborationSignal: "medium",
      chiefScientist: "Prof. D. Whitfield, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "ACT", city: "Canberra", focus: "Cross-disciplinary energy-transition research coordination (illustrative)." },
      ],
      dataConfidence: "public-source", lastUpdated: "2025-10-08",
      sourceNotes: ["University research institute page (illustrative)"],
      evidenceSnippet: "Institute page lists grid-integration and storage as core research programs.",
    },
    {
      id: "unsw-hydrogen", name: "UNSW Hydrogen Energy Research Centre", type: "university", state: "NSW",
      sectors: ["Energy"], themes: ["hydrogen-storage", "decarbonisation"],
      summary: "Illustrative university research centre focused on hydrogen production, storage and utilisation.",
      hostOrPartners: "Host: University of New South Wales (illustrative).",
      activeInitiatives: ["Hydrogen storage materials testbed"],
      industryPartners: [],
      relatedFacilities: ["anff"],
      collaborationSignal: "medium",
      chiefScientist: "Prof. H. Nakamura, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "NSW", city: "Sydney", focus: "Hydrogen production and storage testbed leadership (illustrative)." },
      ],
      dataConfidence: "needs-review", lastUpdated: "2025-06-19",
      sourceNotes: ["University centre page (illustrative, last verified over a year ago)"],
      evidenceSnippet: "Centre page describes hydrogen storage testbeds; profile has not been re-verified recently.",
    },
    {
      id: "monash-energy", name: "Monash Energy Institute", type: "university", state: "VIC",
      sectors: ["Energy", "Manufacturing"], themes: ["battery-storage", "decarbonisation"],
      summary: "Illustrative university institute researching battery materials and energy-system decarbonisation.",
      hostOrPartners: "Host: Monash University (illustrative).",
      activeInitiatives: ["Battery materials degradation research"],
      industryPartners: [],
      relatedFacilities: [],
      collaborationSignal: "low",
      chiefScientist: "Dr. E. Osei, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "VIC", city: "Melbourne", focus: "Battery-materials research group leadership (illustrative)." },
      ],
      dataConfidence: "public-source", lastUpdated: "2025-08-27",
      sourceNotes: ["University institute page (illustrative)"],
      evidenceSnippet: "Institute page lists battery-materials research groups among its programs.",
    },
    {
      id: "cefc", name: "Clean Energy Finance Corporation", type: "government_agency", state: "NSW",
      sectors: ["Finance", "Energy"], themes: ["decarbonisation"],
      summary: "Illustrative government finance body supporting investment in clean-energy and decarbonisation projects.",
      hostOrPartners: "Commonwealth investment vehicle (illustrative representation for demo purposes).",
      activeInitiatives: ["Industrial decarbonisation co-finance program"],
      industryPartners: [],
      relatedFacilities: [],
      collaborationSignal: "medium",
      chiefScientist: "Dr. J. Alavi, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "NSW", city: "Sydney", focus: "Clean-energy investment portfolio leadership (illustrative)." },
        { role: "branch", state: "VIC", city: "Melbourne", focus: "Co-finance regional origination office (illustrative)." },
      ],
      dataConfidence: "verified", lastUpdated: "2026-02-11",
      sourceNotes: ["Public investment portfolio summaries (illustrative)"],
      evidenceSnippet: "Portfolio summaries reference co-financing of CRC-linked decarbonisation projects.",
    },
    {
      id: "nzea", name: "Net Zero Economy Agency", type: "government_agency", state: "VIC",
      sectors: ["Policy & Regional Transition"], themes: ["decarbonisation", "climate-adaptation"],
      summary: "Illustrative government agency coordinating regional and industrial net-zero transition support.",
      hostOrPartners: "Commonwealth agency (illustrative representation for demo purposes).",
      activeInitiatives: ["Regional transition planning support"],
      industryPartners: [],
      relatedFacilities: [],
      collaborationSignal: "low",
      chiefScientist: "Prof. C. Reyes, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "VIC", city: "Melbourne", focus: "National transition strategy and program leadership (illustrative)." },
        { role: "branch", state: "QLD", city: "Brisbane", focus: "Regional transition planning support (illustrative)." },
      ],
      dataConfidence: "public-source", lastUpdated: "2025-07-30",
      sourceNotes: ["Public agency briefings (illustrative)"],
      evidenceSnippet: "Agency briefings describe support for regional industrial transition planning.",
    },
    {
      id: "tonsley", name: "Tonsley Innovation District", type: "technology_precinct", state: "SA",
      sectors: ["Manufacturing"], themes: ["advanced-manufacturing", "battery-storage"],
      summary: "Illustrative innovation precinct hosting advanced-manufacturing and clean-technology tenants.",
      capability: "Co-located manufacturing, prototyping and start-up tenancy space.",
      accessModel: "Precinct tenancy and partnership model (illustrative).",
      relatedFacilities: [],
      dataConfidence: "public-source", lastUpdated: "2025-05-16",
      sourceNotes: ["Precinct directory listing (illustrative)"],
      evidenceSnippet: "Precinct directory lists advanced-manufacturing and battery-adjacent tenants.",
    },
    {
      id: "cicada", name: "Cicada Innovations", type: "incubator_accelerator", state: "NSW",
      sectors: ["Deep Tech & Research Translation"], themes: ["research-translation", "decarbonisation"],
      summary: "Illustrative deep-tech incubator supporting translation of university and CRC research into start-ups.",
      capability: "Incubation, mentoring and lab-adjacent workspace for deep-tech ventures.",
      accessModel: "Cohort-based incubation program (illustrative).",
      relatedFacilities: [],
      chiefScientist: "Dr. N. Petrov, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "NSW", city: "Sydney", focus: "Deep-tech cohort program leadership (illustrative)." },
        { role: "branch", state: "VIC", city: "Melbourne", focus: "Cohort expansion and mentoring network (illustrative)." },
      ],
      dataConfidence: "public-source", lastUpdated: "2025-09-02",
      sourceNotes: ["Incubator public program page (illustrative)"],
      evidenceSnippet: "Program page lists clean-technology ventures among current cohorts.",
    },
    {
      id: "pilbara-cluster", name: "Pilbara Industry Partner Cluster", type: "industry_partner", state: "WA",
      sectors: ["Critical Minerals", "Manufacturing"], themes: ["critical-minerals", "industrial-heat", "decarbonisation"],
      summary: "Illustrative cluster of resources and heavy-industry partners collaborating on decarbonisation trials in the Pilbara region.",
      hostOrPartners: "Industry cluster (illustrative aggregation for demo purposes).",
      activeInitiatives: ["Off-grid renewable haulage trial"],
      industryPartners: [],
      relatedFacilities: ["pawsey"],
      collaborationSignal: "medium",
      chiefScientist: "Dr. F. Nguyen, Chief Scientist (illustrative)",
      offices: [
        { role: "head", state: "WA", city: "Karratha", focus: "Pilbara regional decarbonisation trial coordination (illustrative)." },
      ],
      dataConfidence: "inferred", lastUpdated: "2025-04-21",
      sourceNotes: ["Aggregated from public industry announcements (illustrative, relationship inferred)"],
      evidenceSnippet: "Public announcements reference regional decarbonisation trials; specific CRC linkages are inferred for this demo.",
    },
  ];

  const themeNodes = [
    {
      id: "decarbonisation", name: "Decarbonisation", type: "research_theme",
      summary: "Cross-cutting theme covering reduction of greenhouse-gas emissions across industry, energy and regional economies.",
      keyActorIds: ["hilt-crc", "co2crc", "race2030-crc", "csiro-energy", "nzea"],
      geographicDistribution: "Concentrated in VIC and NSW, with an emerging WA industrial cluster.",
      historicalTrend: "Steady growth in program activity over the past three years (illustrative trend).",
      relatedProjects: ["anu-battery-program"],
      gaps: ["Limited confirmed CRC presence in QLD, TAS and NT (illustrative gap)."],
      dataConfidence: "public-source", lastUpdated: "2026-03-01",
    },
    {
      id: "hydrogen-storage", name: "Hydrogen Storage", type: "research_theme",
      summary: "Research into safe, efficient storage and handling of hydrogen for energy and industrial use.",
      keyActorIds: ["unsw-hydrogen", "csiro-energy", "anff"],
      geographicDistribution: "Concentrated in NSW and ACT.",
      historicalTrend: "Emerging theme with growing facility interest (illustrative trend).",
      relatedProjects: [],
      gaps: ["No confirmed pilot-subset activity in WA or QLD (illustrative gap)."],
      dataConfidence: "public-source", lastUpdated: "2025-11-05",
    },
    {
      id: "battery-storage", name: "Battery Storage", type: "research_theme",
      summary: "Research and industry activity across battery materials, manufacturing and grid-scale storage.",
      keyActorIds: ["fbi-crc", "anff", "monash-energy", "tonsley"],
      geographicDistribution: "Anchored in WA with manufacturing links in SA and VIC.",
      historicalTrend: "Fast-growing theme, driven by battery-industry CRC activity (illustrative trend).",
      relatedProjects: ["anu-battery-program", "battery-recycling-pilot"],
      gaps: ["Recycling-specific facility coverage outside WA is thin (illustrative gap)."],
      dataConfidence: "verified", lastUpdated: "2026-05-20",
    },
    {
      id: "carbon-capture", name: "Carbon Capture", type: "research_theme",
      summary: "Research into capture, utilisation and geological storage of carbon dioxide.",
      keyActorIds: ["co2crc"],
      geographicDistribution: "Field trials concentrated in VIC.",
      historicalTrend: "Stable, long-running program activity (illustrative trend).",
      relatedProjects: [],
      gaps: ["Single-CRC coverage in the current pilot subset — limited redundancy (illustrative gap)."],
      dataConfidence: "public-source", lastUpdated: "2025-11-22",
    },
    {
      id: "critical-minerals", name: "Critical Minerals", type: "research_theme",
      summary: "Research supporting processing, supply-chain and industry capability for critical minerals.",
      keyActorIds: ["pawsey", "pilbara-cluster", "fbi-crc"],
      geographicDistribution: "Concentrated in WA.",
      historicalTrend: "Growing interest linked to battery supply chains (illustrative trend).",
      relatedProjects: [],
      gaps: ["Limited east-coast processing-capability linkage in this pilot subset (illustrative gap)."],
      dataConfidence: "inferred", lastUpdated: "2025-04-21",
    },
    {
      id: "grid-integration", name: "Grid Integration", type: "research_theme",
      summary: "Research on integrating distributed and renewable energy resources into the electricity grid.",
      keyActorIds: ["race2030-crc", "anu-eci", "nci"],
      geographicDistribution: "Concentrated in NSW and ACT.",
      historicalTrend: "Steady growth tracking renewable-energy rollout (illustrative trend).",
      relatedProjects: ["anu-battery-program"],
      gaps: ["Limited confirmed activity in SA despite high renewable penetration (illustrative gap)."],
      dataConfidence: "public-source", lastUpdated: "2026-01-30",
    },
  ];

  const projectNodes = [
    {
      id: "anu-battery-program", name: "ANU Battery Storage and Grid Integration Program", type: "project_initiative",
      hostId: "anu-eci", themes: ["battery-storage", "grid-integration"], state: "ACT",
      summary: "Illustrative university program researching grid-scale battery storage integration.",
      dataConfidence: "public-source", lastUpdated: "2025-10-08",
      evidenceSnippet: "Program listed under ANU Energy Change Institute's public research pages.",
    },
    {
      id: "battery-recycling-pilot", name: "Battery Recycling Pilot Program", type: "project_initiative",
      hostId: "fbi-crc", themes: ["battery-recycling", "critical-minerals"], state: "WA",
      summary: "Illustrative CRC pilot program researching battery end-of-life recycling pathways.",
      dataConfidence: "verified", lastUpdated: "2026-05-18",
      evidenceSnippet: "Pilot program listed in CRC public directory entry as an active initiative.",
    },
  ];

  // Union of all graph-renderable nodes
  const allNodes = [].concat(actors, themeNodes, projectNodes);

  // ---------------------------------------------------------------------
  // Relationships (graph edges)
  // ---------------------------------------------------------------------
  const relationships = [
    { id: "r1",  sourceId: "hilt-crc",       targetId: "co2crc",         type: "collaborates_with",         intensity: "medium", confidence: "public-source", lastUpdated: "2025-11-22", evidence: "Both CRCs are cited together in a joint industrial-decarbonisation workshop summary (illustrative)." },
    { id: "r2",  sourceId: "fbi-crc",        targetId: "race2030-crc",   type: "collaborates_with",         intensity: "weak",   confidence: "inferred",      lastUpdated: "2025-09-01", evidence: "Overlapping interest in grid-connected battery storage inferred from public program scopes (illustrative)." },
    { id: "r3",  sourceId: "co2crc",         targetId: "race2030-crc",   type: "collaborates_with",         intensity: "weak",   confidence: "needs-review",  lastUpdated: "2025-06-10", evidence: "Referenced together in a regional decarbonisation panel listing (illustrative, unverified)." },
    { id: "r4",  sourceId: "anff",           targetId: "hilt-crc",       type: "provides_infrastructure_to", intensity: "medium", confidence: "public-source", lastUpdated: "2026-03-04", evidence: "CRC program page lists ANFF fabrication access among supporting infrastructure (illustrative)." },
    { id: "r5",  sourceId: "anff",           targetId: "fbi-crc",        type: "shares_research_theme",      intensity: "strong", confidence: "verified",      lastUpdated: "2026-05-18", evidence: "Both organisations are tagged with the research theme 'Battery storage' in public program descriptions (illustrative)." },
    { id: "r6",  sourceId: "nci",            targetId: "race2030-crc",   type: "provides_infrastructure_to", intensity: "medium", confidence: "public-source", lastUpdated: "2026-01-30", evidence: "CRC modelling program references NCI computational allocation (illustrative)." },
    { id: "r7",  sourceId: "pawsey",         targetId: "fbi-crc",        type: "provides_infrastructure_to", intensity: "weak",   confidence: "inferred",      lastUpdated: "2025-12-01", evidence: "Minerals-processing simulation workloads inferred to support battery supply-chain research (illustrative)." },
    { id: "r8",  sourceId: "pawsey",         targetId: "pilbara-cluster",type: "shares_research_theme",      intensity: "medium", confidence: "inferred",      lastUpdated: "2025-12-01", evidence: "Both tagged with 'Critical minerals'; specific project link is inferred for this demo (illustrative)." },
    { id: "r9",  sourceId: "unsw-hydrogen",  targetId: "hilt-crc",       type: "collaborates_with",         intensity: "weak",   confidence: "needs-review",  lastUpdated: "2025-06-19", evidence: "Referenced together in an older workshop attendee list; not recently re-verified (illustrative)." },
    { id: "r10", sourceId: "anu-eci",        targetId: "race2030-crc",   type: "collaborates_with",         intensity: "medium", confidence: "public-source", lastUpdated: "2026-01-30", evidence: "ANU institute listed as a research partner on a RACE for 2030 project page (illustrative)." },
    { id: "r11", sourceId: "monash-energy",  targetId: "fbi-crc",        type: "collaborates_with",         intensity: "weak",   confidence: "public-source", lastUpdated: "2025-08-27", evidence: "Joint authorship noted on a public battery-materials research summary (illustrative)." },
    { id: "r12", sourceId: "hilt-crc",       targetId: "nzea",           type: "funded_by",                 intensity: "medium", confidence: "public-source", lastUpdated: "2025-07-30", evidence: "Agency briefing lists co-support for heavy-industry transition programs (illustrative)." },
    { id: "r13", sourceId: "co2crc",         targetId: "cefc",           type: "funded_by",                 intensity: "medium", confidence: "verified",      lastUpdated: "2026-02-11", evidence: "Public investment portfolio lists co-financing of a CO2CRC-linked storage trial (illustrative)." },
    { id: "r14", sourceId: "fbi-crc",        targetId: "cefc",           type: "funded_by",                 intensity: "strong", confidence: "verified",      lastUpdated: "2026-02-11", evidence: "Public investment portfolio lists co-financing of a battery-recycling pilot (illustrative)." },
    { id: "r15", sourceId: "fbi-crc",        targetId: "pilbara-cluster",type: "industry_partner_of",        intensity: "strong", confidence: "inferred",      lastUpdated: "2025-04-21", evidence: "Public industry announcements associate the cluster with battery-industry CRC trials (illustrative, inferred)." },
    { id: "r16", sourceId: "hilt-crc",       targetId: "pilbara-cluster",type: "industry_partner_of",        intensity: "medium", confidence: "inferred",      lastUpdated: "2025-04-21", evidence: "Public announcements reference heavy-industry trial partners in the Pilbara (illustrative, inferred)." },
    { id: "r17", sourceId: "co2crc",         targetId: "pilbara-cluster",type: "industry_partner_of",        intensity: "weak",   confidence: "needs-review",  lastUpdated: "2025-04-21", evidence: "Older announcement mentions a storage feasibility study; not recently re-verified (illustrative)." },
    { id: "r18", sourceId: "fbi-crc",        targetId: "tonsley",       type: "located_in_precinct",        intensity: "weak",   confidence: "public-source", lastUpdated: "2025-05-16", evidence: "Precinct directory lists a battery-manufacturing tenant linked to the CRC network (illustrative)." },
    { id: "r19", sourceId: "cicada",         targetId: "fbi-crc",        type: "collaborates_with",         intensity: "weak",   confidence: "public-source", lastUpdated: "2025-09-02", evidence: "Incubator cohort page lists a battery-recycling spin-out originating from CRC research (illustrative)." },
    { id: "r20", sourceId: "cicada",         targetId: "csiro-energy",   type: "collaborates_with",         intensity: "medium", confidence: "public-source", lastUpdated: "2025-09-02", evidence: "Incubator program page lists CSIRO Energy as a technical mentor partner (illustrative)." },
    { id: "r21", sourceId: "nzea",           targetId: "pilbara-cluster",type: "supports_sector",            intensity: "weak",   confidence: "public-source", lastUpdated: "2025-07-30", evidence: "Agency briefing references regional transition support in resource-sector regions (illustrative)." },
    { id: "r22", sourceId: "cefc",           targetId: "hilt-crc",       type: "supports_sector",            intensity: "weak",   confidence: "public-source", lastUpdated: "2026-02-11", evidence: "Investment portfolio summary references sector-level support for heavy-industry transition (illustrative)." },
    // theme <-> actor edges
    { id: "r23", sourceId: "decarbonisation",  targetId: "hilt-crc",     type: "shares_research_theme", intensity: "strong", confidence: "public-source", lastUpdated: "2026-03-01", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r24", sourceId: "decarbonisation",  targetId: "co2crc",       type: "shares_research_theme", intensity: "strong", confidence: "public-source", lastUpdated: "2026-03-01", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r25", sourceId: "decarbonisation",  targetId: "race2030-crc", type: "shares_research_theme", intensity: "medium", confidence: "public-source", lastUpdated: "2026-03-01", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r26", sourceId: "decarbonisation",  targetId: "csiro-energy", type: "shares_research_theme", intensity: "strong", confidence: "verified",      lastUpdated: "2026-03-01", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r27", sourceId: "decarbonisation",  targetId: "nzea",         type: "shares_research_theme", intensity: "medium", confidence: "public-source", lastUpdated: "2026-03-01", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r28", sourceId: "hydrogen-storage", targetId: "unsw-hydrogen",type: "shares_research_theme", intensity: "strong", confidence: "needs-review",  lastUpdated: "2025-11-05", evidence: "Tagged theme match; source profile due for re-verification (illustrative)." },
    { id: "r29", sourceId: "hydrogen-storage", targetId: "csiro-energy", type: "shares_research_theme", intensity: "medium", confidence: "verified",      lastUpdated: "2025-11-05", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r30", sourceId: "hydrogen-storage", targetId: "anff",         type: "shares_research_theme", intensity: "medium", confidence: "public-source", lastUpdated: "2025-11-05", evidence: "Tagged theme match from capability listing (illustrative)." },
    { id: "r31", sourceId: "battery-storage",  targetId: "fbi-crc",      type: "shares_research_theme", intensity: "strong", confidence: "verified",      lastUpdated: "2026-05-20", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r32", sourceId: "battery-storage",  targetId: "anff",         type: "shares_research_theme", intensity: "strong", confidence: "verified",      lastUpdated: "2026-05-20", evidence: "Tagged theme match from capability listing (illustrative)." },
    { id: "r33", sourceId: "battery-storage",  targetId: "monash-energy",type: "shares_research_theme", intensity: "medium", confidence: "public-source", lastUpdated: "2026-05-20", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r34", sourceId: "battery-storage",  targetId: "tonsley",      type: "shares_research_theme", intensity: "weak",   confidence: "public-source", lastUpdated: "2026-05-20", evidence: "Tagged theme match from precinct directory listing (illustrative)." },
    { id: "r35", sourceId: "carbon-capture",   targetId: "co2crc",       type: "shares_research_theme", intensity: "strong", confidence: "public-source", lastUpdated: "2025-11-22", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r36", sourceId: "critical-minerals",targetId: "pawsey",       type: "shares_research_theme", intensity: "medium", confidence: "public-source", lastUpdated: "2025-04-21", evidence: "Tagged theme match from facility profile (illustrative)." },
    { id: "r37", sourceId: "critical-minerals",targetId: "pilbara-cluster",type:"shares_research_theme", intensity: "medium", confidence: "inferred",      lastUpdated: "2025-04-21", evidence: "Tagged theme match; specific relationship inferred for this demo (illustrative)." },
    { id: "r38", sourceId: "critical-minerals",targetId: "fbi-crc",      type: "shares_research_theme", intensity: "medium", confidence: "public-source", lastUpdated: "2025-04-21", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r39", sourceId: "grid-integration", targetId: "race2030-crc",type: "shares_research_theme", intensity: "strong", confidence: "public-source", lastUpdated: "2026-01-30", evidence: "Tagged theme match from public program description (illustrative)." },
    { id: "r40", sourceId: "grid-integration", targetId: "anu-eci",     type: "shares_research_theme", intensity: "medium", confidence: "public-source", lastUpdated: "2026-01-30", evidence: "Tagged theme match from institute page (illustrative)." },
    { id: "r41", sourceId: "grid-integration", targetId: "nci",         type: "shares_research_theme", intensity: "weak",   confidence: "public-source", lastUpdated: "2026-01-30", evidence: "Tagged theme match from facility profile (illustrative)." },
    // project edges
    { id: "r42", sourceId: "anu-battery-program",  targetId: "anu-eci", type: "hosted_by", intensity: "strong", confidence: "public-source", lastUpdated: "2025-10-08", evidence: "Program listed under ANU Energy Change Institute's public research pages (illustrative)." },
    { id: "r43", sourceId: "battery-recycling-pilot", targetId: "fbi-crc", type: "hosted_by", intensity: "strong", confidence: "verified", lastUpdated: "2026-05-18", evidence: "Pilot program listed as an active CRC initiative (illustrative)." },
    // low-confidence "potential" edges surfaced in gap analysis
    { id: "r44", sourceId: "pilbara-cluster", targetId: "unsw-hydrogen", type: "potential_connection", intensity: "weak", confidence: "needs-review", lastUpdated: "2025-04-21", evidence: "No confirmed link found; flagged as a possible collaboration opportunity for hydrogen use in heavy transport (illustrative, unverified)." },
    { id: "r45", sourceId: "tonsley", targetId: "co2crc", type: "potential_connection", intensity: "weak", confidence: "needs-review", lastUpdated: "2025-05-16", evidence: "No confirmed link found; flagged as a possible capability match for carbon-management manufacturing (illustrative, unverified)." },
  ];

  // ---------------------------------------------------------------------
  // Regions (states/territories) — pilot-subset coverage counts
  // ---------------------------------------------------------------------
  const regions = STATES.map((s) => {
    const inState = actors.filter((a) => a.state === s.code);
    return {
      code: s.code,
      name: s.name,
      crcCount: inState.filter((a) => a.type === "crc").length,
      ncrisCount: inState.filter((a) => a.type === "ncris_facility").length,
      orgCount: inState.length,
      capabilityDensity: (() => {
        const n = inState.length;
        if (n >= 4) return "high";
        if (n >= 1) return "medium";
        return "low";
      })(),
      decarbHotspot: ["VIC", "WA"].indexOf(s.code) !== -1,
      collaborationLinks: relationships.filter((r) => {
        const src = allNodes.find((n) => n.id === r.sourceId);
        const tgt = allNodes.find((n) => n.id === r.targetId);
        return (src && src.state === s.code) || (tgt && tgt.state === s.code);
      }).length,
    };
  });

  // ---------------------------------------------------------------------
  // Plain-English AI Discovery — mock Q&A bank
  // ---------------------------------------------------------------------
  const questions = [
    {
      id: "q1",
      query: "Which CRCs are active in decarbonisation?",
      matchKeywords: ["crc", "decarbonisation", "active"],
      answer: "Four CRCs in the pilot subset carry an active decarbonisation focus: Heavy Industry Low-carbon Transition CRC and CO2CRC work directly on industrial and carbon-management pathways, while RACE for 2030 CRC and Future Battery Industries CRC contribute through grid-integration and battery-storage research that supports the broader transition.",
      relevantEntityIds: ["hilt-crc", "co2crc", "race2030-crc", "fbi-crc", "decarbonisation"],
      evidence: ["Theme tag 'Decarbonisation' matched on 3 CRC profiles", "Adjacent theme overlap (battery-storage, grid-integration) on 1 CRC profile"],
      suggestedVisualisation: "Open the Ecosystem Network centred on 'Decarbonisation' at 2-hop depth.",
      vizAction: { view: "network", centerNodeId: "decarbonisation", hop: 2 },
      confidence: "public-source",
      followUps: ["Which NCRIS facilities support these CRCs?", "Show collaboration gaps for decarbonisation."],
    },
    {
      id: "q2",
      query: "Show NCRIS facilities that could support hydrogen storage research.",
      matchKeywords: ["ncris", "facilit", "hydrogen"],
      answer: "Within the pilot subset, Australian National Fabrication Facility is the NCRIS facility most directly tagged to hydrogen storage, via shared-theme and infrastructure links to CSIRO Energy and UNSW Hydrogen Energy Research Centre. No other NCRIS facility in this subset currently carries a hydrogen-storage tag — this is flagged as a coverage gap, not a confirmed absence of capability.",
      relevantEntityIds: ["anff", "csiro-energy", "unsw-hydrogen", "hydrogen-storage"],
      evidence: ["Theme tag 'Hydrogen storage' matched on 1 NCRIS facility, 1 government agency, 1 university"],
      suggestedVisualisation: "Open the Sector / Theme Explorer on 'Hydrogen'.",
      vizAction: { view: "geo", themeCategoryId: "hydrogen" },
      confidence: "public-source",
      followUps: ["Which universities work on hydrogen storage?", "What collaboration gaps exist in regional decarbonisation?"],
    },
    {
      id: "q3",
      query: "Where are battery recycling capabilities clustered?",
      matchKeywords: ["battery", "recycl", "cluster"],
      answer: "Battery recycling activity in this pilot subset is concentrated in Western Australia, anchored by Future Battery Industries CRC's Battery Recycling Pilot Program and supported by the Pilbara Industry Partner Cluster and Pawsey Supercomputing Research Centre. No other state currently shows tagged recycling activity in this subset.",
      relevantEntityIds: ["fbi-crc", "battery-recycling-pilot", "pilbara-cluster", "pawsey"],
      evidence: ["Theme tag 'Battery recycling' matched on 2 records, both located in WA"],
      suggestedVisualisation: "Open Geography and filter to Western Australia.",
      vizAction: { view: "geo", stateCode: "WA" },
      confidence: "verified",
      followUps: ["Which industry partners are linked to this cluster?", "Add these actors to a shortlist for briefing."],
    },
    {
      id: "q4",
      query: "Which organisations connect universities and industry in clean energy?",
      matchKeywords: ["connect", "universit", "industry", "bridg"],
      answer: "Cicada Innovations is the clearest bridging organisation in this subset, linking CRC and university-originated research (Future Battery Industries CRC, CSIRO Energy) to industry-facing translation programs. Monash Energy Institute also shows a direct industry-facing collaboration link into Future Battery Industries CRC.",
      relevantEntityIds: ["cicada", "monash-energy", "fbi-crc", "csiro-energy"],
      evidence: ["2 collaborates_with edges from 'cicada' cross the research-performer / industry_gov group boundary"],
      suggestedVisualisation: "Open the Ecosystem Network and select 'cicada' to see its bridging edges highlighted.",
      vizAction: { view: "network", centerNodeId: "cicada", selectNodeId: "cicada" },
      confidence: "public-source",
      followUps: ["Show the strongest collaboration path from Cicada Innovations.", "What collaboration gaps exist in regional decarbonisation?"],
    },
    {
      id: "q5",
      query: "What collaboration gaps exist in regional decarbonisation?",
      matchKeywords: ["gap", "region", "collaboration"],
      answer: "Queensland, Tasmania and the Northern Territory currently show no confirmed CRC or NCRIS presence in this pilot subset, despite national decarbonisation relevance. This is an under-connected-region signal, not a claim that no activity exists there — it reflects the current pilot's data coverage.",
      relevantEntityIds: [],
      evidence: ["Region coverage table: QLD, TAS and NT each show 0 tagged CRC/NCRIS actors in this pilot subset"],
      suggestedVisualisation: "Open Insights and review 'Under-connected regions'.",
      vizAction: { view: "insights" },
      confidence: "needs-review",
      followUps: ["Which CRCs are active in decarbonisation?", "Show me suggested opportunities."],
    },
  ];

  // ---------------------------------------------------------------------
  // Ecosystem Intelligence / Insights
  // ---------------------------------------------------------------------
  const insights = {
    topCollaborationClusters: [
      { name: "Battery & Critical Minerals (WA)", actorIds: ["fbi-crc", "pawsey", "pilbara-cluster", "anff"], strength: "strong" },
      { name: "Decarbonisation Policy & Finance (VIC/NSW)", actorIds: ["nzea", "cefc", "hilt-crc", "co2crc"], strength: "medium" },
      { name: "Grid & Computation (NSW/ACT)", actorIds: ["race2030-crc", "anu-eci", "nci"], strength: "medium" },
    ],
    underConnectedRegions: [
      { code: "QLD", note: "No confirmed CRC or NCRIS actor in this pilot subset." },
      { code: "TAS", note: "No confirmed CRC or NCRIS actor in this pilot subset." },
      { code: "NT", note: "No confirmed CRC or NCRIS actor in this pilot subset." },
    ],
    fastGrowingThemes: [
      { themeId: "battery-storage", trend: "up" },
      { themeId: "hydrogen-storage", trend: "up" },
      { themeId: "carbon-capture", trend: "steady" },
      { themeId: "grid-integration", trend: "up" },
    ],
    bridgingOrgs: [
      { actorId: "cicada", score: 0.82, note: "Connects university/CRC research with industry-facing translation programs." },
      { actorId: "csiro-energy", score: 0.9, note: "High-degree connector across CRCs, universities and an incubator." },
      { actorId: "anff", score: 0.71, note: "Shared infrastructure link between a heavy-industry CRC and a battery CRC." },
    ],
    crcNcrisStrength: {
      crcs: ["hilt-crc", "fbi-crc", "co2crc", "race2030-crc"],
      facilities: ["anff", "nci", "pawsey"],
      matrix: [
        [2, 0, 0],
        [3, 0, 1],
        [0, 0, 0],
        [0, 2, 0],
      ],
    },
    decarbonisationGaps: [
      "No confirmed CRC-to-NCRIS link in Queensland within this pilot subset.",
      "Hydrogen-storage facility coverage is concentrated in ACT/NSW with no WA presence.",
      "CO2CRC has no confirmed NCRIS infrastructure link in this pilot subset.",
    ],
    opportunities: [
      { text: "Tonsley Innovation District capability may match CO2CRC decarbonisation manufacturing needs.", relatedActorIds: ["tonsley", "co2crc"], confidence: "needs-review" },
      { text: "Pilbara industry partners could benefit from a formal link to UNSW Hydrogen Energy Research Centre.", relatedActorIds: ["pilbara-cluster", "unsw-hydrogen"], confidence: "needs-review" },
    ],
  };

  // ---------------------------------------------------------------------
  // Domains: a top-level grouping above individual research themes. Adding
  // a new field of R&D later (health, digital & AI, etc.) only means
  // appending one more entry here — it does not add a flat pile of new
  // theme chips to every filter / explorer view across the app.
  // ---------------------------------------------------------------------
  const domains = [
    {
      id: "decarbonisation-energy", label: "Decarbonisation & Energy",
      themeIds: ["decarbonisation", "grid-integration", "hydrogen-storage", "critical-minerals", "battery-storage", "carbon-capture"],
    },
  ];

  // A few categories use a shorter label/id than their underlying theme node
  // (e.g. theme "Hydrogen Storage" shows as the "Hydrogen" explorer chip).
  const CATEGORY_LABEL_OVERRIDES = {
    "hydrogen-storage": { id: "hydrogen", label: "Hydrogen" },
  };

  // ---------------------------------------------------------------------
  // Sector / Theme Explorer top-level categories — derived from `domains`,
  // plus a small number of sector-linked categories with no dedicated
  // theme node yet.
  // ---------------------------------------------------------------------
  const explorerCategories = domains.reduce((acc, domain) => {
    domain.themeIds.forEach((themeId) => {
      const theme = themeNodes.filter((t) => t.id === themeId)[0];
      if (!theme) return;
      const ov = CATEGORY_LABEL_OVERRIDES[themeId];
      acc.push({
        id: ov ? ov.id : themeId,
        label: ov ? ov.label : theme.name,
        themeId: themeId,
        domainId: domain.id,
        inPilot: true,
      });
    });
    return acc;
  }, []).concat([
    { id: "advanced-manufacturing", label: "Advanced manufacturing", themeId: "advanced-manufacturing", domainId: "decarbonisation-energy", inPilot: true, note: "Tagged across CRC, NCRIS-facility and precinct profiles (no dedicated theme node yet)." },
    { id: "digital-infrastructure", label: "Digital infrastructure", themeId: "digital-infrastructure", domainId: "decarbonisation-energy", inPilot: true, note: "National Computational Infrastructure and Pawsey Supercomputing Research Centre." },
  ]);

  // ---------------------------------------------------------------------
  // Data Trust / sources
  // ---------------------------------------------------------------------
  const sources = [
    { name: "Public directories", type: "public_directory", notes: "Illustrative stand-in for public CRC/NCRIS/university directory listings." },
    { name: "CRA publications and ecosystem maps", type: "publication", notes: "Illustrative stand-in for Cooperative Research Australia's own published ecosystem material." },
    { name: "Government datasets", type: "govt_dataset", notes: "Illustrative stand-in for open government datasets on research and innovation programs." },
    { name: "CRC public information", type: "crc_public_info", notes: "Illustrative stand-in for individual CRC program pages and annual reports." },
    { name: "NCRIS facility information", type: "ncris_info", notes: "Illustrative stand-in for NCRIS capability directory listings." },
    { name: "Research organisation pages", type: "research_org_page", notes: "Illustrative stand-in for university and research-institute program pages." },
    { name: "Innovation precinct directories", type: "precinct_directory", notes: "Illustrative stand-in for precinct and incubator tenancy directories." },
    { name: "Manual stakeholder validation", type: "manual_validation", notes: "Illustrative stand-in for direct validation conversations with ecosystem stakeholders." },
  ];

  // ---------------------------------------------------------------------
  // Demo walkthrough script
  // ---------------------------------------------------------------------
  const walkthrough = {
    scenario: "A policy analyst at CRA wants to understand the decarbonisation R&D ecosystem and identify collaboration pathways between CRCs, NCRIS facilities, universities, and industry partners.",
    steps: [
      { caption: "Step 1 — Search “decarbonisation” in the Intelligent Directory.", target: "#searchInput" },
      { caption: "Step 2 — Open a Directory result to see its full entity profile.", target: "#drawer" },
      { caption: "Step 3 — Switch to the Ecosystem Network, centred on “Decarbonisation”.", target: "#canvasWrap" },
      { caption: "Step 4 — Explain the connection between Future Battery Industries CRC and the Australian National Fabrication Facility.", target: "#explainBtn" },
      { caption: "Step 5 — Open the Geography map to see the ecosystem by state and territory.", target: "#auMap" },
      { caption: "Step 6 — Ask the AI Discovery assistant: “Where are battery recycling capabilities clustered?”", target: "#aiInput" },
      { caption: "Step 7 — Add three actors to the shortlist.", target: "#shortlistBtn" },
      { caption: "Step 8 — Generate a briefing preview from the shortlist.", target: "#shortlistDrawer" },
    ],
  };

  return {
    TYPE_META, RELATIONSHIP_META, CONFIDENCE_META, STATES, domains,
    actors, themeNodes, projectNodes, allNodes, relationships,
    regions, questions, insights, explorerCategories, sources, walkthrough,
  };
})();
