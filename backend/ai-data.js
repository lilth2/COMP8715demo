"use strict";

const TYPE_META = {
  crc: { label: "CRC", group: "research_performer" },
  university: { label: "University", group: "research_performer" },
  research_institute: { label: "Research Institute", group: "research_performer" },
  ncris_facility: { label: "NCRIS Facility", group: "infrastructure" },
  technology_precinct: { label: "Technology Precinct", group: "infrastructure" },
  industry_partner: { label: "Industry Partner", group: "industry_gov" },
  government_agency: { label: "Government Agency", group: "industry_gov" },
  incubator_accelerator: { label: "Incubator / Accelerator", group: "industry_gov" },
  research_theme: { label: "Research Theme", group: "concept" },
  project: { label: "Project", group: "concept" },
};

const RELATIONSHIP_META = {
  collaborates_with: { label: "Collaborates with" },
  funded_by: { label: "Funded by" },
  hosted_by: { label: "Hosted by" },
  provides_infrastructure_to: { label: "Provides infrastructure to" },
  participates_in: { label: "Participates in" },
  shares_research_theme: { label: "Shares research theme" },
};

const CONFIDENCE_META = {
  verified: { label: "Verified", rank: 4 },
  "public-source": { label: "Public source", rank: 3 },
  inferred: { label: "Inferred relationship", rank: 2 },
  "needs-review": { label: "Needs review", rank: 1 },
};

const STATES = [
  { code: "NSW", name: "New South Wales" },
  { code: "VIC", name: "Victoria" },
  { code: "QLD", name: "Queensland" },
  { code: "WA", name: "Western Australia" },
  { code: "SA", name: "South Australia" },
  { code: "TAS", name: "Tasmania" },
  { code: "ACT", name: "Australian Capital Territory" },
  { code: "NT", name: "Northern Territory" },
];

function buildAIData(publicData) {
  const actors = publicData.actors || [];
  const projectNodes = publicData.projects || [];
  const themeNodes = publicData.themes || [];
  const relationshipTypes = publicData.relationshipTypes || [];

  function relTypeLabel(id) {
    const live = relationshipTypes.find(function (type) {
      return type.id === id;
    });

    if (live) {
      return live.displayName;
    }

    return (RELATIONSHIP_META[id] || {}).label || id;
  }

  return {
    ...publicData,

    TYPE_META,
    RELATIONSHIP_META,
    CONFIDENCE_META,
    STATES,

    actors,
    projectNodes,
    themeNodes,

    allNodes: [].concat(
      actors,
      themeNodes,
      projectNodes
    ),

    relationships: publicData.relationships || [],
    relationshipTypes,

    relTypeLabel,
  };
}

module.exports = {
  buildAIData,
};
