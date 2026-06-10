// Curated lab/science wordlist that seeds the spell-checker's personal dictionary
// so common bench vocabulary is not flagged as misspelled. This is DATA (a list),
// not an algorithm. It is the static seed; on top of it the app auto-seeds the
// user's own vocabulary (inventory item names, method-catalog terms, words the
// user adds), so the checker is tuned to each lab without anyone hand-curating.
//
// No permissively-licensed biomedical wordlist exists (the good ones are
// NonCommercial or GPL), so this is hand-curated. Extend freely; lowercase, one
// concept per entry. House style applies to comments only, not the list.

export const SCIENTIFIC_WORDLIST: string[] = [
  // Molecular biology / cloning
  "pcr", "qpcr", "rtpcr", "ddpcr", "amplicon", "amplify", "amplification",
  "primer", "primers", "oligonucleotide", "oligo", "oligos", "annealing",
  "denaturation", "elongation", "thermocycler", "miniprep", "midiprep",
  "maxiprep", "plasmid", "plasmids", "vector", "backbone", "insert", "ligation",
  "ligate", "ligase", "digest", "digestion", "endonuclease", "exonuclease",
  "restriction", "transformation", "transform", "transfection", "transfect",
  "electroporation", "electroporate", "competent", "colony", "colonies",
  "ampicillin", "kanamycin", "chloramphenicol", "spectinomycin", "carbenicillin",
  "iptg", "gibson", "golden", "gateway", "cloning", "cre", "lox", "att",
  "crispr", "cas9", "grna", "sgrna", "guide", "knockout", "knockin", "knockdown",
  "sirna", "shrna", "mirna", "dsdna", "ssdna", "cdna", "mrna", "trna", "rrna",
  "genomic", "genome", "amplicon", "barcode", "barcoded", "adapter", "adaptor",
  // Proteins / biochem
  "western", "northern", "southern", "blot", "blotting", "sds", "page",
  "electrophoresis", "gel", "agarose", "acrylamide", "polyacrylamide",
  "coomassie", "ponceau", "immunoblot", "immunoprecipitation", "coip", "ip",
  "lysate", "lysis", "lyse", "supernatant", "pellet", "resuspend", "aliquot",
  "aliquots", "elute", "eluate", "elution", "wash", "bind", "binding",
  "antibody", "antibodies", "epitope", "antigen", "isotype", "polyclonal",
  "monoclonal", "secondary", "conjugate", "conjugated", "biotinylated",
  "histag", "flag", "gst", "mbp", "strep", "his", "tagged", "fusion",
  "chromatography", "hplc", "fplc", "spectrometry", "spectrometer", "spectra",
  "absorbance", "fluorescence", "fluorophore", "fluorescent", "luminescence",
  "gfp", "rfp", "yfp", "cfp", "mcherry", "mscarlet", "venus", "tdtomato",
  "kinase", "phosphatase", "phosphorylation", "phosphorylated", "ubiquitin",
  "proteasome", "denature", "renature", "refold", "aggregate", "soluble",
  // Reagents / buffers
  "dmem", "rpmi", "fbs", "fcs", "trypsin", "edta", "egta", "tris", "pbs",
  "tbs", "tween", "triton", "bsa", "dtt", "tcep", "pmsf", "glycerol",
  "imidazole", "betamercaptoethanol", "mercaptoethanol", "guanidine", "urea",
  "sucrose", "glycine", "hepes", "mops", "mes", "bicine", "tricine",
  "ethidium", "sybr", "gelred", "dapi", "hoechst", "propidium",
  "polymerase", "taq", "phusion", "q5", "kapa", "reverse", "transcriptase",
  "dntp", "dntps", "datp", "dttp", "dctp", "dgtp", "mgcl", "nacl", "kcl",
  // Cell culture / micro
  "confluent", "confluency", "passage", "passaged", "subculture", "seeding",
  "adherent", "suspension", "trypsinize", "viability", "apoptosis", "necrosis",
  "incubate", "incubation", "incubator", "humidified", "sterile", "aseptic",
  "autoclave", "autoclaved", "filtered", "filter", "biosafety", "laminar",
  "hek", "hela", "cho", "jurkat", "raw", "thp", "ipsc", "esc", "organoid",
  "bacteria", "bacterial", "ecoli", "competent", "overnight", "innoculate",
  "inoculate", "inoculation", "streak", "plate", "plated", "broth", "agar",
  "ampcillin", "selection", "selectable", "marker", "resistance", "resistant",
  // Microscopy / imaging
  "confocal", "widefield", "epifluorescence", "brightfield", "phase",
  "objective", "magnification", "zstack", "tile", "stitch", "deconvolution",
  "channel", "merge", "overlay", "roi", "intensity", "exposure", "binning",
  // Measurements / units (the spell-checker tokenizes around digits/symbols)
  "microliter", "microliters", "microgram", "micrograms", "micromolar",
  "nanomolar", "millimolar", "nanogram", "nanograms", "kda", "mwco",
  "rpm", "rcf", "od", "absorbance", "molarity", "molar", "stock", "dilution",
  "serial", "fold", "aliquot", "volume", "concentration", "concentrated",
  // General lab
  "centrifuge", "centrifugation", "centrifuged", "vortex", "vortexed",
  "sonicate", "sonication", "pipette", "pipet", "pipetting", "tip", "tips",
  "eppendorf", "falcon", "cryovial", "cryo", "freezer", "fridge", "thaw",
  "thawed", "frozen", "aliquoted", "labeled", "labelled", "reagent",
  "reagents", "protocol", "protocols", "assay", "assays", "titration",
  "titrate", "normalize", "normalized", "calibrate", "calibration", "standard",
  "blank", "negative", "positive", "control", "replicate", "triplicate",
  "duplicate", "biological", "technical", "timepoint", "timepoints", "workflow",
];
