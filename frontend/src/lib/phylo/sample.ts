// Sample tree + metadata + alignment for the Tree Studio "Try a sample" buttons.
// Lives in lib (not the component) so the parser regression test can guard the
// exact SAMPLE_TREE string the UI loads, with no risk of the literal drifting.
// A small 7-taxon Aspergillus tree with branch lengths and bootstrap supports.

export const SAMPLE_TREE =
  "((A. fumigatus:0.5,A. fischeri:0.5)100:0.3,((A. flavus:0.45,A. oryzae:0.45)96:0.25,(A. nidulans:0.55,(A. niger:0.4,P. chrysogenum:0.6)90:0.2)85:0.18)80:0.15);";

export const SAMPLE_CSV = [
  "tip,section,genome,gliP",
  "A. fumigatus,Fumigati,29.4,yes",
  "A. fischeri,Fumigati,32.5,no",
  "A. flavus,Flavi,37.0,yes",
  "A. oryzae,Flavi,37.1,no",
  "A. nidulans,Nidulantes,30.1,no",
  "A. niger,Nigri,34.0,yes",
  "P. chrysogenum,Outgroup,32.2,no",
].join("\n");

// A tiny aligned FASTA over the sample tree's tips, so "Sample alignment" shows
// the msa track without a file. Gaps are intentional (a real alignment has them).
export const SAMPLE_ALIGNMENT = [
  ">A. fumigatus",
  "ATGCATGC-TAGCTAGCATCG",
  ">A. fischeri",
  "ATGCATGC-TAGCTAGCATGG",
  ">A. flavus",
  "ATGCATGCATAGCT-GCATCG",
  ">A. oryzae",
  "ATGCATGCATAGCT-GCATCG",
  ">A. nidulans",
  "ATGGATGCATA-CTAGCATCG",
  ">A. niger",
  "ATGCATGCATAGCTAGCAT-G",
  ">P. chrysogenum",
  "TTGCATGCATAGCTAGCATCA",
].join("\n");
