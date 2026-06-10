#!/usr/bin/env node
// Generator script for frontend/public/spellcheck/bench-terms.txt
//
// Run from the repo root or from frontend/:
//   node frontend/scripts/build-bench-wordlist.mjs
//
// Output: frontend/public/spellcheck/bench-terms.txt
//   Newline-delimited, lowercase, alphabetic only (a-z plus apostrophe for
//   possessives), >= 3 chars, deduplicated, sorted.
//
// Sources and licenses:
//   - NCBI Taxonomy (public domain, US Government work):
//       common-name model organisms, genus/species names used in prose.
//       https://www.ncbi.nlm.nih.gov/taxonomy
//   - ChEBI Chemical Entities of Biological Interest (CC BY 4.0, EMBL-EBI):
//       common reagent and metabolite names.
//       https://www.ebi.ac.uk/chebi/
//   - PubChem (public domain, NIH/NLM):
//       common compound and chemical names.
//       https://pubchem.ncbi.nlm.nih.gov/
//   - Hand-curated molecular biology / biochemistry / cell biology /
//       genetics / genomics / microscopy / lab-technique vocabulary
//       assembled from domain knowledge.
//
// This script embeds the curated lists inline rather than downloading
// large ontology dumps. Quality and relevance are prioritised over raw
// count. Every term must be a real word a researcher would type in
// running prose.

import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "../public/spellcheck/bench-terms.txt");

// ---------------------------------------------------------------------------
// MODEL ORGANISMS (NCBI Taxonomy, public domain)
// Common names and genus/species prose forms used by researchers.
// ---------------------------------------------------------------------------
const MODEL_ORGANISMS = [
  // Bacteria
  "escherichia", "salmonella", "staphylococcus", "streptococcus", "bacillus",
  "clostridium", "pseudomonas", "klebsiella", "haemophilus", "mycobacterium",
  "helicobacter", "campylobacter", "listeria", "enterococcus", "enterobacter",
  "vibrio", "shigella", "bordetella", "brucella", "yersinia", "francisella",
  "legionella", "neisseria", "treponema", "borrelia", "leptospira",
  "mycoplasma", "chlamydia", "rickettsia", "ehrlichia", "coxiella",
  "spirochete", "spirochetes", "bacteroides", "fusobacterium", "prevotella",
  "firmicutes", "proteobacteria", "actinobacteria", "cyanobacteria",
  "lactobacillus", "bifidobacterium", "lactococcus", "streptomyces",
  "corynebacterium", "propionibacterium", "rhizobium", "agrobacterium",
  "caulobacter", "synechocystis", "thermus", "aquifex", "deinococcus",
  // Yeast and fungi
  "saccharomyces", "cerevisiae", "candida", "aspergillus", "neurospora",
  "schizosaccharomyces", "pombe", "kluyveromyces", "pichia", "yarrowia",
  "ustilago", "cryptococcus", "mucor", "rhizopus", "penicillium",
  "trichoderma", "fusarium", "magnaporthe", "botrytis", "alternaria",
  "coccidioides", "histoplasma", "blastomyces", "sporothrix",
  // Plants
  "arabidopsis", "thaliana", "nicotiana", "tobacco", "solanum", "lycopersicum",
  "tomato", "zea", "maize", "oryza", "sativa", "rice", "triticum", "wheat",
  "hordeum", "barley", "sorghum", "setaria", "brachypodium", "populus",
  "eucalyptus", "medicago", "lotus", "glycine", "soybean", "phaseolus",
  "vitis", "grapevine", "anthocyanin", "chloroplast", "chloroplasts",
  // Worms and flies
  "caenorhabditis", "elegans", "nematode", "nematodes", "drosophila",
  "melanogaster", "diptera", "anopheles", "aedes", "culex",
  // Zebrafish and vertebrates
  "danio", "rerio", "zebrafish", "xenopus", "laevis", "tropicalis",
  "mus", "musculus", "rattus", "norvegicus", "gallus", "oryctolagus",
  "macaca", "rhesus", "cynomolgus", "marmoset", "chimpanzee",
  // Marine and other model organisms
  "strongylocentrotus", "sea urchin", "hydra", "planaria",
  "tetrahymena", "paramecium", "chlamydomonas", "volvox",
  "dictyostelium", "physarum",
  // Viruses (common names for prose use)
  "adenovirus", "adenoviral", "lentivirus", "lentiviral", "retrovirus",
  "retroviral", "baculovirus", "baculoviral", "vaccinia", "herpesvirus",
  "cytomegalovirus", "influenza", "coronavirus", "rotavirus", "norovirus",
  "enterovirus", "rhinovirus", "alphavirus", "flavivirus", "bunyavirus",
  "rhabdovirus", "paramyxovirus", "orthomyxovirus", "poxvirus",
  "papillomavirus", "polyomavirus", "parvovirus", "bacteriophage", "phage",
  "prophage", "lysogenic", "lysogeny", "lytic",
];

// ---------------------------------------------------------------------------
// TECHNIQUES AND METHODS
// ---------------------------------------------------------------------------
const TECHNIQUES = [
  // PCR and nucleic acid methods
  "amplification", "denaturation", "annealing", "elongation",
  "thermocycler", "thermocycling", "endpoint", "quantitative",
  "droplet", "emulsion", "amplicon", "primer", "primers",
  "oligonucleotide", "oligonucleotides", "hybridization", "hybridise",
  "hybridize", "prehybridization",
  // Cloning
  "subcloning", "recloning", "directional", "blunt", "cohesive",
  "overhangs", "overhang", "compatible", "incompatible",
  "recombination", "recombinase", "integrase", "transposase",
  "transposon", "transposons", "insertion", "insertional", "excision",
  "mutagenesis", "site-directed", "saturation", "random",
  "in vitro", "in vivo", "in situ",
  // Sequencing
  "sequencing", "sanger", "dideoxy", "capillary", "nanopore",
  "illumina", "pacbio", "longread", "shortread", "paired-end",
  "single-end", "shotgun", "metagenomic", "metagenomics",
  "transcriptome", "transcriptomic", "transcriptomics",
  "methylome", "methylation", "methylated", "unmethylated",
  "bisulfite", "chromatin", "accessibility",
  "demultiplex", "demultiplexed", "demultiplexing",
  "basecalling", "basecall", "consensus", "assembly",
  "denovo", "scaffold", "scaffolding", "contig", "contigs",
  "annotation", "annotated", "annotate", "reannotation",
  // Gel and blotting
  "denaturing", "nondenaturing", "native", "reducing",
  "nonreducing", "resolving", "stacking", "running",
  "nitrocellulose", "pvdf", "membrane", "transfer",
  "blocking", "stripping", "reprobing", "chemiluminescence",
  "autoradiography", "autoradiograph", "phosphorimager",
  "densitometry", "densitometric",
  // Cell-based assays
  "transfection", "lipofection", "nucleofection", "microinjection",
  "electroporation", "transformation", "transduction",
  "coinfection", "coinfect", "superinfection", "multiplicity",
  "luciferase", "reporter", "reporters", "promoter",
  "enhancer", "silencer", "repressor", "activator",
  "transactivation", "transrepression",
  // Protein methods
  "immunoprecipitation", "coimmunoprecipitation", "pulldown",
  "pulldowns", "crosslink", "crosslinking", "crosslinked",
  "formaldehyde", "glutaraldehyde", "paraformaldehyde",
  "fixation", "permeabilization", "permeabilize",
  "subcellular", "fractionation", "fractionated",
  "ultracentrifugation", "ultracentrifuge", "sedimentation",
  "equilibrium", "velocity", "gradient", "sucrose",
  "glycerol", "ficoll", "percoll", "nycodenz",
  // Protein expression and purification
  "recombinant", "heterologous", "homologous",
  "overexpression", "overexpress", "coexpression",
  "coexpress", "expression", "induction", "inducer",
  "constitutive", "inducible", "repressible",
  "refolding", "renaturation", "denaturation",
  "solubilization", "solubilize", "resolubilize",
  "affinity", "ionexchange", "sizeexclusion", "hydrophobic",
  "interaction", "reversed-phase", "purification",
  "purify", "purified", "enrichment", "enriched",
  "depletion", "depleted", "precipitate", "precipitation",
  "ammonium sulfate", "dialysis", "dialyze", "ultrafiltration",
  "ultrafiltrate", "concentration", "diafiltration",
  "tangential", "flux",
  // Microscopy
  "confocal", "widefield", "epifluorescence", "brightfield",
  "darkfield", "differential", "interference", "contrast",
  "deconvolution", "deconvolve", "superresolution",
  "sted", "palm", "storm", "sim", "tirf", "fret",
  "fluorescence", "fluorescent", "fluorophore", "fluorochrome",
  "chromophore", "photobleaching", "photoactivation",
  "photoconversion", "phototoxicity", "photoactivatable",
  "colocalization", "colocalisation", "colocalise",
  "colocalize", "puncta", "punctate", "diffuse",
  "perinuclear", "cytoplasmic", "nuclear", "nucleolar",
  "mitochondrial", "lysosomal", "endosomal", "plasma",
  "membrane-bound", "soluble", "aggregated",
  "live-cell", "livecell", "fixed", "unfixed",
  "staining", "immunostaining", "immunofluorescence",
  "immunohistochemistry", "immunocytochemistry",
  "zstack", "zseries", "timelapse", "kymograph",
  "montage", "ratiometric", "normalization",
  "flatfield", "darkfield", "background",
  "subtraction", "thresholding", "segmentation",
  "morphology", "morphological", "phenotype",
  "phenotypic", "genotype", "genotypic",
  "heterozygous", "homozygous", "hemizygous",
  "allele", "alleles", "locus", "loci",
  "haplotype", "diploid", "haploid", "polyploid",
  "aneuploid", "aneuploidy",
  // Flow cytometry
  "cytometry", "cytometer", "gating", "gate", "gates",
  "scatter", "forward", "side", "autofluorescence",
  "compensation", "spectral", "unmixing", "sorting",
  "sorter", "electrostatic", "deflection",
  // CRISPR and editing
  "nuclease", "endonuclease", "nickase", "deaminase",
  "transposome", "cytidine", "adenosine",
  "homology-directed", "nonhomologous", "endjoining",
  "indel", "indels", "frameshift", "premature",
  "stopcodon", "readthrough", "nonsense",
  "missense", "synonymous", "nonsynonymous",
  "splice", "splicing", "alternative",
  "isoform", "isoforms", "exon", "exons",
  "intron", "introns", "spliceosome",
  // ChIP and epigenomics
  "chromatin", "nucleosome", "nucleosomes", "histone",
  "histones", "acetylation", "acetylated", "acetylase",
  "deacetylase", "methylation", "methyltransferase",
  "demethylase", "ubiquitination", "ubiquitinase",
  "sumoylation", "neddylation", "phosphorylation",
  "kinase", "phosphatase", "remodeling", "remodelling",
  "coactivator", "corepressor", "mediator",
  "enhancer", "superenhancer", "insulator",
  "topological", "compartment", "loop",
  "lamina", "heterochromatin", "euchromatin",
  // RNA biology
  "splicing", "polyadenylation", "capping",
  "untranslated", "ribosome", "ribosomes",
  "ribosomal", "polysome", "monosome",
  "translation", "elongation", "termination",
  "initiation", "codon", "anticodon",
  "wobble", "decoding", "aminoacyl",
  "ribozyme", "ribozymes", "aptamer", "aptamers",
  "ribonuclease", "ribonucleases", "nuclease",
  "degradation", "degradome", "interactome",
  "transcriptome", "proteome", "metabolome",
  "epigenome", "genome", "metagenome",
  "pangenome", "exome", "regulome",
  // Metabolomics and lipidomics
  "metabolomics", "lipidomics", "glycomics",
  "phosphoproteomics", "ubiquitinomics",
  "glycoprotein", "glycoproteomics", "glycan",
  "glycans", "glycosylation", "glycosylated",
  "glycosyltransferase",
  // Mass spectrometry
  "spectrometry", "spectrometer", "chromatography",
  "ionization", "ionize", "electrospray",
  "desorption", "matrix", "maldi", "tof",
  "quadrupole", "orbitrap", "fourier",
  "tandem", "precursor", "fragment",
  "fragmentation", "collision",
  "abundance", "intensity", "signal",
  "retention", "elution", "gradient",
  "mobile", "stationary", "column",
  "peptide", "peptides", "tryptic",
  "trypsin", "chymotrypsin", "thermolysin",
  "lys-c", "glu-c", "asp-n", "protease",
  "proteases", "proteasome", "proteasomal",
  "ubiquitin", "proteinase", "inhibitor",
  "inhibitors", "inhibition", "substrate",
  "substrates", "product", "products",
];

// ---------------------------------------------------------------------------
// BIOCHEMISTRY AND MOLECULAR BIOLOGY VOCABULARY
// ---------------------------------------------------------------------------
const BIOCHEM_VOCAB = [
  // Nucleic acids and genetics
  "deoxyribonucleic", "ribonucleic", "nucleotide", "nucleotides",
  "nucleoside", "nucleosides", "purine", "purines", "pyrimidine",
  "pyrimidines", "adenine", "guanine", "cytosine", "thymine",
  "uracil", "hypoxanthine", "xanthine", "inosine",
  "phosphodiester", "phosphodiesterase", "topoisomerase",
  "gyrase", "helicase", "primase", "replicase",
  "polymerase", "proofreading", "exonuclease",
  "ligase", "recombinase", "resolvase",
  "telomere", "telomeres", "telomerase",
  "centromere", "centromeres", "kinetochore",
  "kinetochores", "chromatid", "chromatids",
  "karyotype", "karyotyping",
  // Amino acids
  "alanine", "arginine", "asparagine", "aspartate",
  "cysteine", "glutamine", "glutamate", "glycine",
  "histidine", "isoleucine", "leucine", "lysine",
  "methionine", "phenylalanine", "proline", "serine",
  "threonine", "tryptophan", "tyrosine", "valine",
  "selenocysteine", "pyrrolysine", "hydroxyproline",
  "hydroxylysine", "phosphoserine", "phosphothreonine",
  "phosphotyrosine", "acetyllysine", "methylarginine",
  // Protein structure
  "polypeptide", "polypeptides", "peptide", "peptides",
  "tertiary", "quaternary", "secondary", "alpha-helix",
  "betasheet", "betastrand", "betahairpin",
  "coiled-coil", "leucine zipper", "helixturnhelix",
  "beta-barrel", "betapropeller", "timbeta",
  "immunoglobulin", "fibronectin", "cadherin",
  "kringle", "ankyrin", "armadillo", "tpr",
  "wd40", "kelch", "tudor", "chromo",
  "bromodomain", "phd", "ring", "ubiquitin",
  "pleckstrin", "dbl", "ras", "gtpase",
  "atpase", "permease", "translocase",
  "chaperone", "chaperones", "chaperonin",
  "hsp70", "hsp90", "groel", "groes",
  "peptidyl", "prolyl", "isomerase",
  "disulfide", "thioredoxin", "glutaredoxin",
  "glutathione", "peroxiredoxin",
  // Lipids and membranes
  "phospholipid", "phospholipids", "glycolipid",
  "glycolipids", "sphingolipid", "sphingolipids",
  "sphingomyelin", "ceramide", "ceramides",
  "cholesterol", "cholesteryl", "sterol", "sterols",
  "fatty acid", "saturated", "unsaturated",
  "polyunsaturated", "monounsaturated",
  "cis", "trans", "omega", "arachidonic",
  "eicosanoid", "prostaglandin", "leukotriene",
  "thromboxane", "lipoxin", "resolvin",
  "lysophosphatidic", "sphingosine", "phosphatidyl",
  "phosphatidylserine", "phosphatidylinositol",
  "phosphatidylcholine", "phosphatidylethanolamine",
  "inositol", "phosphoinositide", "cardiolipin",
  "plasmalogens", "ether lipid", "bilayer",
  "monolayer", "liposome", "liposomes",
  "micelle", "micelles", "vesicle", "vesicles",
  "exosome", "exosomes", "microvesicle",
  "microvesicles",
  // Carbohydrates
  "glucose", "galactose", "fructose", "mannose",
  "fucose", "xylose", "ribose", "deoxyribose",
  "glucuronate", "glucosamine", "galactosamine",
  "sialic acid", "neuraminidase", "lactose",
  "sucrose", "trehalose", "maltose", "cellobiose",
  "glycogen", "starch", "cellulose", "chitin",
  "heparin", "heparan", "chondroitin", "dermatan",
  "hyaluronic", "hyaluronate", "proteoglycan",
  "proteoglycans",
  // Enzymes and catalysis
  "enzyme", "enzymes", "enzymatic", "catalysis",
  "catalytic", "catalyze", "substrate", "substrates",
  "product", "turnover", "kcat", "vmax", "michaelis",
  "menten", "inhibitor", "competitive", "noncompetitive",
  "uncompetitive", "allosteric", "cooperative",
  "coenzyme", "cofactor", "prosthetic",
  "activator", "effector", "zymogen",
  "apoenzyme", "holoenzyme", "isoenzyme",
  "isozyme", "isoforms",
  // Metabolism
  "glycolysis", "glycolytic", "gluconeogenesis",
  "gluconeogenic", "pentose", "tricarboxylic",
  "krebs", "citric", "oxidative",
  "phosphorylation", "substrate-level",
  "fermentation", "anaerobic", "aerobic",
  "catabolism", "catabolic", "anabolism",
  "anabolic", "amphibolic", "autotroph",
  "heterotroph", "chemoautotroph",
  "acetyl-coa", "acetate", "pyruvate",
  "lactate", "succinate", "fumarate",
  "malate", "oxaloacetate", "citrate",
  "isocitrate", "alpha-ketoglutarate",
  "succinyl-coa", "glyoxylate",
  "gluconate", "glucuronate",
  "fatty acid oxidation", "beta-oxidation",
  "ketogenesis", "ketone", "ketones",
  "ketoacidosis", "lipolysis", "lipogenesis",
  "lipogenics",
  // Cell biology
  "mitosis", "mitotic", "meiosis", "meiotic",
  "cytokinesis", "interphase", "prophase",
  "metaphase", "anaphase", "telophase",
  "checkpoint", "checkpoints", "cyclin",
  "cyclins", "cdk", "phosphorylation",
  "ubiquitination", "proteasomal",
  "apoptosis", "apoptotic", "autophagy",
  "autophagic", "necrosis", "necroptosis",
  "pyroptosis", "ferroptosis", "anoikis",
  "senescence", "senescent", "quiescence",
  "quiescent", "differentiation", "dedifferentiation",
  "transdifferentiation", "stemness",
  "pluripotency", "pluripotent", "multipotent",
  "totipotent", "progenitor", "precursor",
  "lineage", "clonogenic", "proliferative",
  "proliferation", "antiproliferative",
  "cytostatic", "cytotoxic", "cytotoxicity",
  "viability", "apoptotic",
  // Signaling
  "phosphorylation", "dephosphorylation",
  "ubiquitination", "deubiquitination",
  "acetylation", "deacetylation",
  "methylation", "demethylation",
  "sumoylation", "neddylation",
  "prenylation", "palmitoylation",
  "myristoylation", "farnesylation",
  "geranylgeranylation", "glycosylation",
  "o-glcnac", "galactosylation",
  "sialylation", "fucosylation",
  "nitrosylation", "carbonylation",
  "oxidation", "glutathionylation",
  "receptor", "receptors", "ligand",
  "ligands", "agonist", "antagonist",
  "partial agonist", "inverse agonist",
  "allosteric", "orthosteric", "cryptic",
  "binding site", "active site",
  "tyrosine kinase", "serine kinase",
  "threonine kinase", "phosphoinositide",
  "downstream", "upstream", "pathway",
  "cascade", "signalosome", "scaffold",
  "adapter", "docking", "recruitment",
  "translocation", "activation", "inactivation",
  "feedback", "feedforward", "crosstalk",
  // Immunology
  "immunoglobulin", "immunoglobulins",
  "antibody", "antibodies", "antigen",
  "antigens", "epitope", "epitopes",
  "paratope", "hapten", "haptens",
  "complement", "complement fixation",
  "opsonization", "phagocytosis",
  "endocytosis", "macropinocytosis",
  "exocytosis", "secretion",
  "granule", "granules", "degranulation",
  "cytokine", "cytokines", "chemokine",
  "chemokines", "interleukin", "interferon",
  "lymphokine", "monokine", "adipokine",
  "inflammasome", "pyroptosis",
  "innate", "adaptive", "humoral",
  "cellular", "immunological",
  "immunodeficiency", "autoimmunity",
  "autoimmune", "tolerance", "anergy",
  "clonal selection", "affinity maturation",
  "somatic hypermutation", "class switching",
  "immunodominant", "immunodominance",
  "antigen-presenting", "dendritic",
  "lymphocyte", "lymphocytes", "leukocyte",
  "leukocytes", "neutrophil", "neutrophils",
  "eosinophil", "eosinophils", "basophil",
  "basophils", "monocyte", "monocytes",
  "macrophage", "macrophages",
  "microglia", "microglial",
  // Genetics and genomics
  "genotype", "phenotype", "haplotype",
  "karyotype", "karyotypic",
  "heterozygous", "homozygous", "hemizygous",
  "wild-type", "mutant", "mutation",
  "polymorphism", "polymorphisms",
  "snp", "indel", "copy number",
  "inversion", "transposition", "duplication",
  "deletion", "insertion", "frameshift",
  "missense", "nonsense", "synonymous",
  "nonsynonymous", "stopgain", "splicing",
  "dominant", "recessive", "codominant",
  "epistasis", "epistatic", "pleiotropy",
  "pleiotropic", "penetrance", "expressivity",
  "imprinting", "genomic imprinting",
  "methylation", "epigenetics", "epigenetic",
  "heritable", "heritability",
  "quantitative trait", "locus",
  "qtl", "gwas",
  "phylogenetics", "phylogenetic",
  "phylogeny", "phylogenomics",
  "cladistics", "cladistic",
  "parsimony", "maximum likelihood",
  "bayesian", "bootstrap",
  "alignment", "alignments",
  "homolog", "homologs", "ortholog",
  "orthologs", "paralog", "paralogs",
  "synteny", "syntenic",
];

// ---------------------------------------------------------------------------
// REAGENTS AND CHEMICALS (ChEBI CC BY 4.0, PubChem public domain)
// Common names used in lab prose.
// ---------------------------------------------------------------------------
const REAGENTS_CHEMICALS = [
  // Buffers and salts
  "acetate", "bicarbonate", "borate", "carbonate",
  "citrate", "formate", "phosphate", "sulfate",
  "sulfite", "thiosulfate", "chloride", "bromide",
  "iodide", "hydroxide", "perchlorate",
  "potassium", "sodium", "lithium", "calcium",
  "magnesium", "manganese", "zinc", "copper",
  "iron", "cobalt", "nickel", "molybdenum",
  "tungsten", "selenium", "vanadium",
  // Common organic solvents and reagents
  "acetonitrile", "methanol", "ethanol", "isopropanol",
  "butanol", "propanol", "hexane", "heptane",
  "octane", "benzene", "toluene", "xylene",
  "chloroform", "dichloromethane", "methylene",
  "tetrahydrofuran", "dioxane", "diethyl ether",
  "ethyl acetate", "acetone", "dimethyl",
  "sulfoxide", "dimethylformamide", "dmf",
  "dimethylacetamide", "pyridine", "piperidine",
  "morpholine", "imidazole",
  // Biochemical reagents
  "dithiothreitol", "mercaptoethanol", "glutathione",
  "ascorbate", "ascorbic", "dehydroascorbate",
  "nicotinamide", "adenine dinucleotide", "nadh",
  "flavin", "flavoprotein", "cytochrome",
  "heme", "hemin", "porphyrin",
  "biotin", "streptavidin", "avidin",
  "neutravidin", "biocytin",
  "rhodamine", "fluorescein", "coumarin",
  "alexa", "atto", "cy3", "cy5", "cy7",
  "pacific blue", "brilliant violet",
  // Protease inhibitors and enzyme substrates
  "phenylmethylsulfonyl", "leupeptin", "pepstatin",
  "aprotinin", "bestatin", "calpain",
  "antipain", "chymostatin", "elastatinal",
  "calyculin", "okadaic", "staurosporine",
  "rapamycin", "wortmannin", "ly294002",
  "sp600125", "sb203580", "pd098059",
  // Fluorescent dyes and probes
  "calcein", "carboxyfluorescein",
  "acridine orange", "ethidium bromide",
  "syto", "picogreen", "ribogreen",
  "nanogreen", "propidium iodide",
  "annexin", "tunel", "terminal",
  "deoxynucleotidyl", "transferase",
  "nick translation",
  // Crosslinkers and fixatives
  "paraformaldehyde", "glutaraldehyde",
  "formaldehyde", "methanol", "acetone",
  "glyoxal", "osmium tetroxide",
  "tannic acid", "uranyl acetate",
  "periodate", "periodate", "oxidation",
  "disuccinimidyl suberate", "dss",
  "bis-sulfosuccinimidyl", "sulfo",
  "maleimide", "iodoacetamide",
  "iodoacetic acid", "dithiobis",
  // Lipid reagents
  "lipofectamine", "fugene", "polyethylenimine",
  "pei", "calcium phosphate",
  "cyclodextrin", "saponin",
  "digitonin", "brij", "nonidet",
  "octyl glucoside", "deoxycholate",
  // Stains
  "commassie", "coomassie", "ponceau",
  "amidoblack", "silver stain",
  "sypro ruby", "sypro orange",
  "gel code blue", "imperial",
  "luna stain",
  // Antibiotics and selection agents
  "puromycin", "hygromycin",
  "blasticidin", "neomycin",
  "geneticin", "zeocin",
  "ampicillin", "kanamycin",
  "chloramphenicol", "tetracycline",
  "erythromycin", "rifampicin",
  "rifamycin", "spectinomycin",
  "carbenicillin", "streptomycin",
  "vancomycin", "lincomycin",
  "trimethoprim", "methotrexate",
  // Induction and signaling compounds
  "doxycycline", "isopropyl",
  "thiogalactopyranoside", "iptg",
  "arabinose", "galactose",
  "cumate", "mifepristone",
  "tamoxifen", "rapamycin",
  "abscisic acid", "gibberellin",
  "auxin", "cytokinin",
  "ethylene", "jasmonate",
  "brassinosteroid", "salicylate",
  // Common biochemical substrates
  "pnpp", "pnpg", "mca",
  "rhodamine-labeled", "fluorogenic",
  "chromogenic", "colorimetric",
  "bioluminescent",
];

// ---------------------------------------------------------------------------
// ANATOMY AND CELL BIOLOGY TERMS
// ---------------------------------------------------------------------------
const CELL_ANATOMY = [
  // Organelles and compartments
  "nucleus", "nucleolus", "cytoplasm", "cytosol",
  "mitochondria", "mitochondrion", "lysosome",
  "lysosomes", "peroxisome", "peroxisomes",
  "endosome", "endosomes", "autophagosome",
  "autolysosome", "multivesicular", "lamellar body",
  "melanosome", "melanosomes",
  "endoplasmic", "reticulum", "sarcoplasmic",
  "golgi", "cis-golgi", "trans-golgi",
  "cisternal", "vesicle", "vesicles",
  "coatomer", "clathrin", "caveolae",
  "caveolin", "caveolinrich",
  "cytoskeleton", "actin", "tubulin",
  "microtubule", "microtubules",
  "microfilament", "microfilaments",
  "intermediate filament", "filament",
  "nucleoporin", "nuclear pore",
  "nuclear lamina", "lamin",
  "spindle", "centriole", "centrosome",
  "basal body", "cilium", "cilia",
  "flagellum", "flagella",
  // Cell types and tissues
  "fibroblast", "fibroblasts", "myoblast",
  "myoblasts", "myocyte", "myocytes",
  "cardiomyocyte", "cardiomyocytes",
  "hepatocyte", "hepatocytes",
  "keratinocyte", "keratinocytes",
  "melanocyte", "melanocytes",
  "osteoblast", "osteoblasts",
  "osteoclast", "osteoclasts",
  "chondrocyte", "chondrocytes",
  "adipocyte", "adipocytes",
  "endothelial", "epithelial",
  "mesenchymal", "neuronal",
  "glial", "astrocyte", "astrocytes",
  "microglia", "microglial",
  "oligodendrocyte", "schwann",
  "photoreceptor", "photoreceptors",
  "pancreatic", "acinar",
  "islet", "beta cell",
  "alveolar", "goblet",
  "ciliated", "cuboidal",
  "columnar", "squamous",
  // Tissues and systems
  "epithelium", "endothelium", "mesothelium",
  "stroma", "parenchyma", "extracellular",
  "matrix", "collagen", "fibronectin",
  "laminin", "vitronectin", "fibrin",
  "elastin", "tenascin", "nidogen",
  "perlecan", "aggrecan", "versican",
  "brevican", "decorin", "biglycan",
  "syndecan", "glypican", "basal lamina",
];

// ---------------------------------------------------------------------------
// LAB EQUIPMENT AND GENERAL VOCABULARY
// ---------------------------------------------------------------------------
const LAB_EQUIPMENT = [
  // Equipment and instruments
  "autoclave", "biosafety cabinet", "laminar flow",
  "fume hood", "centrifuge", "ultracentrifuge",
  "microcentrifuge", "refrigerated",
  "tabletop", "benchtop", "floor-model",
  "spectrophotometer", "nanodrop", "qubit",
  "fluorometer", "luminometer",
  "plate reader", "elisa reader",
  "flow cytometer", "cell sorter",
  "confocal microscope", "widefield",
  "inverted microscope", "upright",
  "dissecting", "dissection",
  "thermocycler", "gradient",
  "digital dry bath", "heat block",
  "water bath", "shaking incubator",
  "orbital shaker", "rocking platform",
  "roller drum", "tube rotator",
  "vortex mixer", "probe sonicator",
  "bath sonicator", "homogenizer",
  "french press", "cell disruptor",
  "bead beater", "nitrogen cavitation",
  "freeze-fracture", "microfluidizer",
  // Consumables
  "microcentrifuge tube", "eppendorf",
  "conical tube", "falcon tube",
  "petri dish", "cell culture flask",
  "tissue culture plate", "well plate",
  "multiwell", "coated", "uncoated",
  "low-attachment", "ultralow",
  "chamber slide", "coverslip",
  "coverglass", "borosilicate",
  "polystyrene", "polypropylene",
  "polyethylene", "polycarbonate",
  "nitrocellulose membrane",
  "pvdf membrane", "filter paper",
  "whatman", "nylon membrane",
  "syringe filter", "spin column",
  "size-exclusion", "gel filtration",
  "affinity resin", "magnetic bead",
  "streptavidin bead", "protein g",
  "protein a", "protein l",
  // Measurement and quantification
  "absorbance", "optical density",
  "transmittance", "reflectance",
  "refractive index", "viscosity",
  "osmolality", "osmolarity",
  "molarity", "molality", "normality",
  "equivalent weight",
  "extinction coefficient",
  "molar absorptivity",
  "stokes radius", "hydrodynamic",
  "sedimentation coefficient",
  // Data analysis
  "normalization", "log-transformation",
  "quantile", "percentile",
  "zscore", "fold change",
  "ratio", "scatter", "variance",
  "covariance", "regression",
  "correlation", "pearson",
  "spearman", "kendall",
  "anova", "ttest", "wilcoxon",
  "mann-whitney", "kruskal-wallis",
  "bonferroni", "benjamini-hochberg",
  "fdr", "pvalue", "qvalue",
  "confidence interval",
  "standard error", "standard deviation",
  "interquartile", "median",
  "bootstrap resampling",
  "permutation test",
  "enrichment analysis",
  "gene ontology", "kegg",
  "reactome", "biocarta",
  "hallmarks", "msigdb",
  "gsea", "ssgsea", "viper",
  "principal component",
  "dimensionality reduction",
  "tsen", "umap", "phate",
  "seurat", "scanpy", "monocle",
  "pseudotime", "trajectory",
  "clustering", "hierarchical",
  "kmeans", "dbscan", "leiden",
  "louvain",
];

// ---------------------------------------------------------------------------
// SAFETY AND REGULATORY VOCABULARY
// ---------------------------------------------------------------------------
const SAFETY_TERMS = [
  "biosafety", "biohazard", "biosafety level",
  "containment", "decontamination", "autoclaving",
  "inactivation", "neutralization",
  "hazardous", "corrosive", "flammable",
  "oxidizing", "toxic", "carcinogenic",
  "mutagen", "mutagenic", "teratogen",
  "teratogenic", "genotoxic",
  "radioactive", "radioisotope",
  "dosimetry", "shielding", "radioprotection",
  "ppe", "gloves", "goggles",
  "respirator", "ventilation",
  "sharps disposal",
  "material safety data", "msds",
  "sds sheet", "ghs",
  "institutional biosafety",
  "institutional review",
  "irb", "iacuc", "fda",
  "clia", "cap accredited",
];

// ---------------------------------------------------------------------------
// BIOINFORMATICS TERMS
// ---------------------------------------------------------------------------
const BIOINFORMATICS = [
  "bioinformatics", "computational",
  "algorithm", "pipeline", "workflow",
  "fastq", "fasta", "vcf", "bam",
  "sam", "cram", "bigwig", "bedgraph",
  "narrowpeak", "broadpeak", "gff",
  "gtf", "bed", "psl",
  "trimming", "adapter trimming",
  "quality control", "fastqc",
  "multiqc", "trimmomatic", "cutadapt",
  "bowtie", "hisat", "star",
  "tophat", "kallisto", "salmon",
  "deseq", "edger", "limma",
  "cufflinks", "stringtie",
  "htseq", "featurecounts",
  "gatk", "picard", "samtools",
  "bedtools", "vcftools",
  "plink", "shapeit", "impute",
  "bcftools", "angsd",
  "snakemake", "nextflow",
  "cwl", "wdl", "cromwell",
  "docker", "singularity",
  "conda", "bioconda",
  "blast", "hmmer", "clustal",
  "muscle", "mafft", "prank",
  "iqtree", "raxml", "beast",
  "fasttree", "mega",
  "refseq", "ensembl", "uniprot",
  "swissprot", "trembl", "pfam",
  "interpro", "panther", "cdd",
  "pdb", "rcsb",
  "ncbi", "embl", "ddbj",
  "geo", "sra", "dbsnp",
  "omim", "mim", "hgnc",
  "entrez", "pubmed", "genbank",
  "cosmic", "clinvar",
];

// ---------------------------------------------------------------------------
// ADDITIONAL TECHNIQUES AND SPECIALIZED VOCABULARY
// ---------------------------------------------------------------------------
const SPECIALIZED = [
  // IHC / ICC
  "immunohistochemistry", "immunocytochemistry",
  "immunofluorescence", "immunoblotting",
  "antigen retrieval", "heat-induced",
  "protease-induced", "epitope retrieval",
  "peroxidase", "alkaline phosphatase",
  "diaminobenzidine", "dab",
  "hematoxylin", "eosin",
  "hematoxylin-eosin", "masson",
  "trichrome", "giemsa",
  "wrightgiemsa", "pas stain",
  "alcian blue", "toluidine blue",
  "crystal violet", "methylene blue",
  "carmine", "gold stain",
  // Protein structural techniques
  "crystallography", "crystallize",
  "crystallization", "crystal structure",
  "diffraction", "synchrotron",
  "refinement", "resolution",
  "electron density", "b-factor",
  "r-factor", "rfree",
  "cryo-em", "cryogenic",
  "cryoelectron", "single-particle",
  "tomography", "tilt series",
  "helical reconstruction",
  "nmr spectroscopy",
  "chemical shift", "noe",
  "nuclear overhauser",
  "relaxation", "dynamics",
  "saxs", "sans", "smfret",
  "single-molecule", "optical trap",
  "magnetic tweezers", "afm",
  "atomic force",
  // Yeast two-hybrid and similar
  "two-hybrid", "yeast two-hybrid",
  "three-hybrid", "one-hybrid",
  "bimolecular", "complementation",
  "split reporter", "proximity ligation",
  "fluorescence complementation",
  "bioluminescence resonance",
  // Animal models
  "xenograft", "xenografts",
  "allograft", "allografts",
  "syngeneic", "immunocompromised",
  "nude mouse", "scid mouse",
  "rag knockout",
  "orthotopic", "subcutaneous",
  "intraperitoneal", "intravenous",
  "intramuscular", "intratumoral",
  "engraftment", "tumor burden",
  "latency", "metastasis",
  "metastatic", "malignant",
  "benign", "invasive",
  "noninvasive", "neoadjuvant",
  "adjuvant", "palliative",
  "prophylactic",
  // Stem cells
  "pluripotent", "multipotent",
  "totipotent", "unipotent",
  "self-renewal", "differentiation",
  "reprogramming", "dedifferentiation",
  "transdifferentiation",
  "induced pluripotent", "embryonic",
  "adult stem", "niche",
  "organoid", "spheroid", "tumoroid",
  "gastruloid",
  // Tissue engineering
  "scaffold", "hydrogel", "bioink",
  "bioprinting", "electrospinning",
  "decellularized", "decellularization",
  "recellularization", "matrigel",
  "cultrex", "corning",
  // Biochemical assays
  "elisa", "enzyme-linked",
  "immunosorbent", "sandwich",
  "competitive elisa", "direct elisa",
  "western blot", "dot blot",
  "far-western", "southwestern",
  "northwestern",
  "gel shift", "emsa",
  "electrophoretic mobility",
  "supershift", "dnase footprinting",
  "dimethyl sulfate", "hydroxyl radical",
  "chip-seq", "atac-seq",
  "rnaseq", "scrnaseq", "scrna",
  "snatacseq", "multiome",
  "spatial transcriptomics",
  "visium", "seqfish", "merfish",
  "stereo-seq", "slideseq",
  "cleavage site", "cleavage",
];

// ---------------------------------------------------------------------------
// NEUROSCIENCE AND PHARMACOLOGY
// ---------------------------------------------------------------------------
const NEUROSCIENCE = [
  // Neuroanatomy
  "hippocampus", "hippocampal", "cortex", "cortical",
  "cerebellum", "cerebellar", "striatum", "striatal",
  "amygdala", "amygdalar", "hypothalamus", "hypothalamic",
  "thalamus", "thalamic", "brainstem", "midbrain",
  "hindbrain", "forebrain", "neocortex", "prefrontal",
  "cingulate", "insular", "parietal", "occipital",
  "temporal", "frontal", "spinal cord",
  "dorsal horn", "ventral horn",
  "substantia nigra", "locus coeruleus",
  "raphe", "cerebral", "ventricular",
  "meningeal", "arachnoid", "dura",
  // Neuron types
  "neuron", "neurons", "interneuron", "interneurons",
  "pyramidal", "granule", "purkinje",
  "dopaminergic", "serotonergic", "noradrenergic",
  "cholinergic", "gabaergic", "glutamatergic",
  "glycinergic", "peptidergic",
  "motor neuron", "sensory neuron",
  "afferent", "efferent",
  // Synapse and signaling
  "synapse", "synapses", "synaptic", "presynaptic",
  "postsynaptic", "excitatory", "inhibitory",
  "vesicle", "neurotransmitter", "neuromodulator",
  "acetylcholine", "dopamine", "serotonin",
  "norepinephrine", "epinephrine",
  "gaba", "glutamate", "glycine",
  "neuropeptide", "substance p",
  "neuropeptide y", "enkephalin", "endorphin",
  "dynorphin", "oxytocin", "vasopressin",
  // Receptor pharmacology
  "nmda receptor", "ampa receptor",
  "kainate receptor", "metabotropic",
  "ionotropic", "ligand-gated",
  "voltage-gated", "sodium channel",
  "potassium channel", "calcium channel",
  "chloride channel", "transient receptor",
  // Electrophysiology
  "electrophysiology", "patch clamp",
  "whole-cell", "cell-attached",
  "outside-out", "inside-out",
  "perforated patch", "sharp electrode",
  "field potential", "local field",
  "multielectrode", "action potential",
  "membrane potential", "resting potential",
  "depolarization", "hyperpolarization",
  "repolarization", "afterhyperpolarization",
  "long-term potentiation", "long-term depression",
  "spike", "burst", "oscillation",
  // Pharmacology
  "pharmacology", "pharmacokinetics",
  "pharmacodynamics", "bioavailability",
  "half-life", "clearance", "volume of distribution",
  "absorption", "distribution", "metabolism",
  "excretion", "first-pass", "oral bioavailability",
  "intraperitoneal", "subcutaneous",
  "intravenous", "intrathecal",
  "intranasal", "topical",
  "therapeutic window", "therapeutic index",
  "lethal dose", "effective dose",
  "ic50", "ec50", "ki", "kd",
  "agonist", "antagonist", "partial agonist",
  "inverse agonist", "allosteric",
  "orthosteric", "biased signaling",
  "desensitization", "downregulation",
  "upregulation", "tolerance",
  "sensitization", "tachyphylaxis",
];

// ---------------------------------------------------------------------------
// PLANT BIOLOGY AND ECOLOGY
// ---------------------------------------------------------------------------
const PLANT_ECOLOGY = [
  // Plant processes
  "photosynthesis", "photorespiration",
  "transpiration", "stomata", "stomatal",
  "guard cell", "mesophyll",
  "chlorophyll", "chlorophylls",
  "carotenoid", "carotenoids",
  "xanthophyll", "phytol",
  "thylakoid", "thylakoids",
  "stroma", "granal", "grana",
  "rubisco", "ribulose bisphosphate",
  "calvinbenson", "photoperiod",
  "photoperiodism", "circadian",
  "circadian clock", "vernalization",
  "germination", "dormancy",
  "senescence", "abscission",
  "tropism", "phototropism",
  "gravitropism", "thigmotropism",
  // Ecology
  "ecosystem", "biome", "habitat",
  "niche", "succession", "trophic",
  "predation", "herbivory", "parasitism",
  "mutualism", "commensalism",
  "competition", "coevolution",
  "symbiosis", "mycorrhizal",
  "mycorrhiza", "rhizosphere",
  "microbiome", "microbiota",
  "metagenomics", "metatranscriptomics",
  "metaproteomics",
  // Developmental biology
  "embryogenesis", "organogenesis",
  "morphogenesis", "patterning",
  "segmentation", "gastrulation",
  "neurulation", "somitogenesis",
  "induction", "competence",
  "determination", "commitment",
  "pluripotency", "totipotency",
  "morphogen", "morphogens",
  "gradient", "threshold",
  "notch", "hedgehog", "wnt",
  "tgf-beta", "bmp", "activin",
  "fgf", "vegf", "egf", "pdgf",
];

// ---------------------------------------------------------------------------
// CANCER BIOLOGY
// ---------------------------------------------------------------------------
const CANCER_BIOLOGY = [
  "oncogene", "oncogenes", "oncogenic",
  "tumor suppressor", "proto-oncogene",
  "carcinoma", "sarcoma", "lymphoma",
  "leukemia", "melanoma", "glioma",
  "glioblastoma", "neuroblastoma",
  "hepatocellular", "renal cell",
  "adenocarcinoma", "squamous cell",
  "malignant", "benign",
  "neoplasm", "neoplastic",
  "tumorigenesis", "carcinogenesis",
  "metastasis", "metastatic",
  "invasion", "invasive",
  "angiogenesis", "angiogenic",
  "neovascularization",
  "epithelial-mesenchymal",
  "mesenchymal-epithelial",
  "cancer stem cell",
  "tumorigenic", "clonogenic",
  "xenograft", "allograft",
  "syngeneic", "immunocompromised",
  "checkpoint inhibitor",
  "immunotherapy", "checkpoint",
  "monoclonal antibody",
  "targeted therapy",
  "tyrosine kinase inhibitor",
  "mek inhibitor", "raf inhibitor",
  "pi3k inhibitor", "akt inhibitor",
  "mtor inhibitor", "cdk inhibitor",
  "parp inhibitor", "bcl2 inhibitor",
  "proteasome inhibitor",
  "histone deacetylase inhibitor",
  "dna methylation inhibitor",
  "hypomethylating", "demethylating",
  "chemotherapy", "cytotoxic",
  "genotoxic", "alkylating",
  "platinum", "taxane",
  "antimetabolite", "topoisomerase",
  "vinca alkaloid",
  "radiotherapy", "radiosensitizer",
  "radioprotector",
];

// ---------------------------------------------------------------------------
// MICROBIOLOGY AND VIROLOGY ADDITIONAL TERMS
// ---------------------------------------------------------------------------
const MICROBIOLOGY_EXTRA = [
  // Microbiology techniques
  "enumeration", "colony forming unit",
  "plaque assay", "plaque forming unit",
  "moi", "multiplicity of infection",
  "viral titer", "titer",
  "limiting dilution", "endpoint dilution",
  "ld50", "id50", "tcid",
  "cytopathic effect", "hemagglutination",
  "neuraminidase inhibition",
  "plaque reduction",
  "coinfection", "superinfection",
  "burst size", "latent period",
  "lytic cycle", "lysogenic cycle",
  // Biofilm
  "biofilm", "biofilms", "quorum sensing",
  "autoinducer", "planktonic",
  "sessile", "dispersal",
  "extracellular polymeric",
  // Antibiotics mechanism
  "bactericidal", "bacteriostatic",
  "minimal inhibitory concentration",
  "minimum bactericidal concentration",
  "disk diffusion", "broth microdilution",
  "checkerboard assay",
  "synergy", "antagonism",
  "beta-lactam", "penicillin binding protein",
  "transpeptidase", "carbapenems",
  "fluoroquinolone", "macrolide",
  "aminoglycoside", "polymyxin",
  "colistin", "vancomycin resistance",
  "meticillin", "oxacillin",
  // Sterilization
  "sterilization", "pasteurization",
  "germicide", "disinfectant",
  "antiseptic", "sanitizer",
  "sporicidal", "virucidal",
  "bactericide", "fungicide",
];

// ---------------------------------------------------------------------------
// PROTEOMICS AND MASS SPEC ADDITIONAL TERMS
// ---------------------------------------------------------------------------
const PROTEOMICS_EXTRA = [
  // Protein modifications
  "phosphopeptide", "phosphoproteome",
  "ubiquitinome", "acetylome",
  "methylome", "sumoylome",
  "glycoproteome", "nitrosoproteome",
  "redoxome",
  // MS methods
  "datadependent", "dataindependent",
  "dia", "dda", "swath",
  "prm", "srm", "mrm",
  "label-free", "silac",
  "iTRAQ", "tmt",
  "dimethyl labeling",
  "isobaric", "chemical labeling",
  "metabolic labeling",
  "top-down", "bottom-up",
  "middle-down",
  "crosslinking", "native ms",
  "hydrogen deuterium exchange",
  "hdx", "hdxms",
  // Protein interactions
  "interactome", "protein complex",
  "protein-protein interaction",
  "protein-dna interaction",
  "protein-rna interaction",
  "protein-lipid interaction",
  "proximity ligation",
  "apex", "bioid", "turboid",
  "promiscuous biotin ligase",
  "biolayer interferometry",
  "surface plasmon resonance",
  "isothermal titration calorimetry",
  "itc", "spr", "bli",
  "differential scanning fluorimetry",
  "thermal shift", "melting curve",
  // Structural proteomics
  "alphafold", "rosettafold",
  "colabfold", "esmfold",
  "structure prediction",
  "molecular dynamics",
  "monte carlo", "normal mode",
  "docking", "virtual screening",
  "pharmacophore", "quantitative",
  "structure-activity relationship",
];

// ---------------------------------------------------------------------------
// CHEMISTRY AND PHYSICAL BIOCHEMISTRY ADDITIONAL TERMS
// ---------------------------------------------------------------------------
const CHEMISTRY_EXTRA = [
  // Organic chemistry terms used in biochemistry
  "carbonyl", "carboxyl", "hydroxyl",
  "amino", "imino", "thiol",
  "disulfide", "sulfhydryl",
  "aldehyde", "ketone", "ester",
  "amide", "peptide bond",
  "phosphoester", "pyrophosphate",
  "nucleophile", "electrophile",
  "leaving group", "reactive",
  "condensation", "hydrolysis",
  "oxidation", "reduction",
  "isomerization", "rearrangement",
  "elimination", "addition",
  "substitution", "radical",
  "carbocation", "carbanion",
  "transition state", "activation energy",
  "reaction coordinate",
  // Thermodynamics
  "enthalpy", "entropy",
  "gibbs free energy", "chemical potential",
  "equilibrium constant", "rate constant",
  "arrhenius", "boltzmann",
  "partition coefficient",
  "solubility product",
  "acid dissociation", "pka",
  "buffer capacity", "henderson",
  "hasselbalch",
  // Spectroscopy
  "ultraviolet", "visible", "infrared",
  "near-infrared", "circular dichroism",
  "raman", "surface-enhanced raman",
  "ftir", "ellipsometry",
  "dynamic light scattering",
  "nanoparticle tracking", "cryo-tem",
  "negative stain",
  // Physical chemistry
  "diffusion coefficient",
  "stokes-einstein",
  "sedimentation equilibrium",
  "analytical ultracentrifugation",
  "size exclusion chromatography",
  "multi-angle light scattering",
  "mals", "viscometry",
  "densitometry",
];

// ---------------------------------------------------------------------------
// GENETICS AND GENOMICS ADDITIONAL TERMS
// ---------------------------------------------------------------------------
const GENOMICS_EXTRA = [
  // Population genetics
  "allele frequency", "minor allele",
  "heterozygosity", "homozygosity",
  "linkage disequilibrium",
  "haplotype block",
  "recombination hotspot",
  "selective sweep", "purifying selection",
  "positive selection", "neutral evolution",
  "genetic drift", "bottleneck",
  "founder effect", "admixture",
  "introgression", "hybridization",
  "speciation", "phylogeography",
  // Epigenetics
  "chromatin remodeling",
  "nucleosome positioning",
  "histone variant",
  "histone modification",
  "bivalent chromatin",
  "polycomb", "trithorax",
  "polycomb repressive complex",
  "cpg island", "cpg methylation",
  "de novo methylation",
  "maintenance methylation",
  "demethylation", "dnmt",
  "tet enzyme", "oxidized methylcytosine",
  "hydroxymethylcytosine",
  "formylcytosine", "carboxylcytosine",
  // Single cell
  "single-cell", "droplet-based",
  "plate-based", "microfluidics",
  "barcode", "umi",
  "unique molecular identifier",
  "doublet", "ambient rna",
  "cell ranger", "starsolo",
  "alevin", "kallisto bustools",
  "seurat", "scanpy",
  "cell type annotation",
  "marker gene", "differentially expressed",
  "pseudobulk", "integration",
  "harmony", "scvi", "bbknn",
  // Genome editing
  "homology arm", "repair template",
  "donor template", "ssodna",
  "dsdna donor", "adeno-associated virus",
  "delivery vehicle",
  "electroporation", "lipid nanoparticle",
  "ribonucleoprotein", "rnp",
  "all-in-one", "dual guide",
  "multiplex editing",
  "base editing", "prime editing",
  "pegarna", "peg",
  "epigenome editing",
  "activation", "repression",
  "dCas9", "dead Cas9",
  "crispra", "crispri", "crisprac",
];

// ---------------------------------------------------------------------------
// ADDITIONAL HIGH-VALUE MOLECULAR BIOLOGY PROSE TERMS
// These are words researchers commonly type in notes, methods sections,
// and experimental write-ups.
// ---------------------------------------------------------------------------
const PROSE_VOCAB = [
  // Lab note verbs and process nouns (forms researchers write)
  "aspirate", "aspirated", "aspirating", "aspiration",
  "decant", "decanted", "decanting",
  "pipette", "pipetted", "pipetting", "micropipette",
  "weigh", "weighed", "weighing", "gravimetric",
  "reconstitute", "reconstituted", "reconstitution",
  "resuspend", "resuspended", "resuspension",
  "centrifuge", "centrifuged", "centrifugation",
  "lyophilize", "lyophilized", "lyophilization", "lyophilisate",
  "lyophiliser",
  "desiccate", "desiccated", "desiccation", "desiccator",
  "precipitate", "precipitated", "coprecipitate",
  "flocculate", "flocculation", "flocculant",
  "filtrate", "permeate", "retentate",
  "supernatant", "pellet", "pellets",
  "homogenate", "homogenize", "homogenized", "homogenizer",
  "solubilize", "solubilized", "solubilization",
  "disperse", "dispersed", "dispersion",
  "emulsify", "emulsified", "emulsification",
  "vortex", "vortexed", "vortexing",
  "sonicate", "sonicated", "sonication",
  "triturate", "trituration",
  "rinse", "rinsed", "rinsing",
  "aspirate", "aspirated",
  // Time and temperature
  "overnight", "room temperature", "ambient",
  "permissive", "restrictive", "semi-permissive",
  "preincubate", "preincubated",
  "prewarm", "prewarmed", "prewarming",
  "equilibrate", "equilibrated", "equilibration",
  "acclimatize", "acclimatized",
  // Preparation adjectives
  "sterile-filtered", "endotoxin-free",
  "nuclease-free", "rnase-free", "dnase-free",
  "protease-free", "low-endotoxin",
  "cell culture-grade", "tissue culture-grade",
  "molecular biology-grade", "sequencing-grade",
  "analytical grade", "reagent grade",
  "pharmaceutical grade", "clinical grade",
  "ultrapure", "highly purified",
  "recombinant", "native",
  "denatured", "renatured",
  "reduced", "non-reduced",
  "biotinylated", "fluorescently labeled",
  "radioactively labeled",
  "phosphorylated", "dephosphorylated",
  // Output and yield terms
  "yield", "recovery", "purity",
  "homogeneity", "heterogeneity",
  "enrichment", "depletion",
  "flowthrough", "unbound", "bound",
  "eluate", "fraction", "fractions",
  "pool", "pooled", "pooling",
  // Experimental design
  "biological replicate", "technical replicate",
  "independent experiment",
  "representative", "reproducible",
  "reproducibility", "repeatability",
  "robust", "quantitative",
  "qualitative", "semiquantitative",
  "limit of detection", "limit of quantification",
  "dynamic range", "linear range",
  "saturation", "non-linear",
  "outlier", "artifact",
];

// ---------------------------------------------------------------------------
// CELL LINE AND MODEL NAMES (NCBI Taxonomy public domain, common knowledge)
// ---------------------------------------------------------------------------
const CELL_LINE_VOCAB = [
  // Common cell line descriptors
  "immortalized", "primary", "secondary",
  "established", "transformed",
  "stable", "transient", "inducible",
  "conditional", "constitutive",
  "parental", "derivative",
  // Species descriptors for cell types
  "murine", "human", "simian",
  "bovine", "porcine", "ovine",
  "canine", "feline", "equine",
  "amphibian", "avian",
  // Cell biology descriptors
  "immortalized", "senescent",
  "malignant", "transformed",
  "nontransformed", "noncancerous",
  "isogenic", "syngeneic",
  // Media and supplements
  "serum-free", "serum-containing",
  "defined medium", "undefined medium",
  "minimal medium", "rich medium",
  "complete medium",
  "nutrient broth", "nutrient agar",
  "luria-bertani", "terrific broth",
  "soc medium", "lysogeny broth",
  "yeast extract", "peptone",
  "tryptone", "casamino acids",
  "m9 minimal", "m63 minimal",
  "nutrient agar", "macconkey",
  "chocolate agar", "blood agar",
  "selective medium", "differential medium",
  "methicillin", "oxacillin",
  // Cell culture conditions
  "monolayer", "three-dimensional",
  "coculture", "cocultures",
  "transwell", "scratch assay",
  "wound healing", "migration",
  "invasion", "clonogenic",
  "clonal expansion", "serial passaging",
  "subcloning", "limiting dilution",
  "mycoplasma", "mycoplasma free",
  "sterility testing",
];

// ---------------------------------------------------------------------------
// OMICS AND SYSTEMS BIOLOGY
// ---------------------------------------------------------------------------
const SYSTEMS_BIOLOGY = [
  // Omics terms
  "genomics", "transcriptomics",
  "proteomics", "metabolomics",
  "lipidomics", "glycomics",
  "epigenomics", "metagenomics",
  "metatranscriptomics", "metaproteomics",
  "multi-omics", "integrative",
  "integromics",
  // Systems biology
  "regulatory network", "gene regulatory",
  "transcription factor network",
  "protein interaction network",
  "metabolic network",
  "signaling network",
  "mathematical modeling",
  "ordinary differential equation",
  "stochastic", "deterministic",
  "Boolean network", "bayesian network",
  "kinetic model", "thermodynamic model",
  "constraint-based modeling",
  "flux balance analysis",
  "stoichiometric matrix",
  "cobra toolbox",
  // Statistical genomics
  "heritability", "polygenic",
  "oligogenic", "monogenic",
  "quantitative genetics",
  "gwas catalog", "mendelian randomization",
  "polygenic risk score",
  "genetic correlation",
  "mediation analysis",
  // Structural variation
  "copy number variant",
  "copy number variation",
  "structural variant",
  "chromosomal rearrangement",
  "translocation", "inversion",
  "deletion", "duplication",
  "insertion", "tandem repeat",
  "microsatellite", "minisatellite",
  "satellite DNA",
  "repetitive element", "transposable element",
  "alu element", "line element",
  "sine element",
];

// ---------------------------------------------------------------------------
// ADDITIONAL REAGENT NAMES (ChEBI CC BY 4.0, PubChem public domain)
// ---------------------------------------------------------------------------
const MORE_REAGENTS = [
  // Common organic chemistry reagents in biochemistry
  "acrylamide", "bisacrylamide",
  "ammonium persulfate", "temed",
  "tetramethylethylenediamine",
  "bromophenol blue", "xylene cyanol",
  "orange g", "loading dye",
  "molecular weight marker",
  "prestained", "unstained",
  "protein ladder", "dna ladder",
  "agarose", "low melting point",
  "ultrapure agarose",
  "sybr gold", "sybr safe",
  "ethidium bromide alternative",
  "redbis", "gelgreen",
  "cyber green",
  // Commonly used enzymes
  "proteinase k", "lysozyme",
  "dnase i", "rnase a",
  "rnase h", "rnase iii",
  "dicer", "drosha",
  "argonaute", "piwi",
  "mung bean nuclease",
  "exonuclease i", "exonuclease iii",
  "s1 nuclease", "bal31",
  "micrococcal nuclease",
  "terminal transferase",
  "polynucleotide kinase",
  "tobacco acid pyrophosphatase",
  "calf intestinal phosphatase",
  "shrimp alkaline phosphatase",
  "antarctic phosphatase",
  // Biochemical substrates and indicators
  "x-gal", "iptg",
  "x-gluc", "mug",
  "onpg", "pnp-glucuronide",
  "nbt", "bcip",
  "abs", "fast red",
  "vector red", "vector blue",
  "tyramide", "polymerized",
  // Chelators and ionophores
  "bapta", "quin-2", "fura-2",
  "indo-1", "fluo-4", "fluo-3",
  "cal-520", "rhod-2",
  "nitrobenzofuran",
  "a23187", "ionomycin",
  "valinomycin", "gramicidin",
  "nigericin", "monensin",
  "carbonyl cyanide", "fccp",
  // Reactive oxygen species
  "reactive oxygen species",
  "superoxide", "hydrogen peroxide",
  "hydroxyl radical", "singlet oxygen",
  "peroxynitrite", "nitric oxide",
  "malondialdehyde", "carbonylation",
  "dcfh-da", "mitoSOX",
  "amplex red", "lucigenin",
  "dihydroethidium",
  // Commonly used inhibitors
  "cycloheximide", "puromycin",
  "anisomycin", "thapsigargin",
  "tunicamycin", "brefeldin",
  "nocodazole", "taxol",
  "cytochalasin", "latrunculin",
  "jasplakinolide", "phalloidin",
  "colchicine", "vinblastine",
  "vincristine",
  "hydroxyurea", "aphidicolin",
  "camptothecin", "etoposide",
  "doxorubicin", "adriamycin",
  "cisplatin", "carboplatin",
  "oxaliplatin", "bleomycin",
  "mitomycin",
  "actinomycin d", "alpha-amanitin",
  "flavopiridol", "roscovitine",
];

// ---------------------------------------------------------------------------
// METHODS AND INSTRUMENTATION VOCABULARY
// ---------------------------------------------------------------------------
const INSTRUMENTATION = [
  // Sequencing platforms and terms
  "illumina sequencing",
  "oxford nanopore", "pacific biosciences",
  "solexa", "next-generation",
  "third-generation", "long-read",
  "short-read", "single-molecule",
  "real-time sequencing",
  "sequencing by synthesis",
  "sequencing by ligation",
  "pyrosequencing", "ion torrent",
  "solid sequencing",
  // Imaging modalities
  "fluorescence microscopy",
  "electron microscopy",
  "scanning electron",
  "transmission electron",
  "cryo-electron",
  "atomic force microscopy",
  "scanning tunneling",
  "stimulated emission depletion",
  "photoactivated localization",
  "stochastic optical reconstruction",
  "structured illumination",
  "light sheet microscopy",
  "selective plane illumination",
  "spinning disk confocal",
  "point scanning confocal",
  "two-photon excitation",
  "multiphoton", "intravital",
  // Chromatography variants
  "reversed phase", "normal phase",
  "ion exchange", "size exclusion",
  "affinity chromatography",
  "hydrophobic interaction",
  "mixed mode",
  "anion exchange", "cation exchange",
  "strong anion exchange",
  "strong cation exchange",
  "gel filtration",
  "gel permeation",
  "preparative", "analytical",
  "semipreparative",
  "ultrafast liquid",
  "microfluidic",
  "nano-flow", "capillary",
  // Centrifugation
  "pelleting", "fractionation",
  "buoyant density",
  "isopycnic", "isodensity",
  "rate zonal", "equilibrium density",
  "differential centrifugation",
  "sucrose gradient",
  "cesium chloride", "cscl",
  "nycodenz gradient",
  "percoll gradient",
  "ficoll gradient",
  "optiprep gradient",
  // Sample preparation
  "sonication", "bead milling",
  "cryogenic grinding", "freeze-thaw",
  "osmotic lysis", "detergent lysis",
  "enzymatic digestion",
  "mechanical disruption",
  "nitrogen cavitation",
  "french press", "microfluidizer",
  "pressure cycling",
  "solid phase extraction",
  "liquid-liquid extraction",
  "protein precipitation",
  "acetone precipitation",
  "tca precipitation",
  "chloroform-methanol",
  "isopropanol precipitation",
  "ethanol precipitation",
  "spri beads",
  "ammonium sulfate fractionation",
];

// ---------------------------------------------------------------------------
// ADDITIONAL TERMS TO ENSURE COMPREHENSIVE COVERAGE
// ---------------------------------------------------------------------------
const FINAL_ADDITIONS = [
  // Genetics and cloning prose
  "overexpressor", "knockdown", "knockout", "knockin",
  "downregulate", "downregulated", "downregulation",
  "upregulate", "upregulated", "upregulation",
  "dysregulate", "dysregulated", "dysregulation",
  "misexpression", "mislocalization", "mistargeting",
  "ectopic", "ectopically", "endogenous",
  "endogenously", "exogenous", "exogenously",
  "heterologously", "homologously",
  "bidirectional", "unidirectional",
  // Western blot and assay terms
  "autoradiograph", "autoradiography",
  "phosphorimager", "densitometry",
  "band", "bands", "smear",
  "doublet", "triplet", "ladder",
  "running front", "gel loading",
  "loading control", "housekeeping",
  "beta-actin", "gapdh", "tubulin",
  "total protein", "normalization",
  "stripping", "reprobing",
  "blocking buffer", "primary antibody",
  "secondary antibody", "hrp conjugate",
  "ap conjugate", "colorimetric",
  "chemiluminescent",
  // PCR protocol words
  "touchdown", "nested", "multiplex",
  "inverse", "colony pcr", "allele-specific",
  "long-range", "hot start",
  "cycling conditions", "cycling program",
  "extension time", "melt curve",
  "dissociation curve", "amplification efficiency",
  "standard curve", "reference gene",
  "housekeeping gene", "normalization gene",
  "delta-delta ct", "deltadeltact",
  "copy number", "absolute quantification",
  "relative quantification",
  // Cell counting and viability
  "hemocytometer", "hemocytometry",
  "coulter counter", "trypan blue",
  "exclusion dye", "viability dye",
  "live dead stain", "pi stain",
  "annexin v", "sub-g1",
  "cell cycle analysis", "propidium",
  "facs analysis", "flow analysis",
  "fluorescence activated",
  "magnetic activated cell sorting",
  "macs sorting", "immunomagnetic",
  // Misc biochemistry prose
  "photocrosslinking", "uv crosslinking",
  "reversible crosslink", "irreversible",
  "pulldown assay", "precipitation assay",
  "cofractionation", "copurification",
  "endogenous tagging", "exogenous expression",
  "overexpressed", "underexpressed",
  "silenced", "depleted", "knocked out",
  "haploinsufficient", "haploinsufficiency",
  "gain-of-function", "loss-of-function",
  "dominant negative", "constitutively active",
  "temperature sensitive", "cold sensitive",
  "suppressor screen", "enhancer screen",
  "synthetic lethality", "synthetically lethal",
  "epistasis", "suppression",
  // Imaging analysis terms
  "pixel", "voxel", "resolution",
  "signal-to-noise", "dynamic range",
  "bit depth", "bit plane",
  "lookup table", "pseudocolor",
  "false color", "brightness",
  "contrast", "gamma correction",
  "shading correction", "flatfield",
  "background subtraction",
  "morphological operation",
  "watershed", "thresholding",
  "segmentation mask",
  "region of interest", "polygon",
  "freehand", "ellipse roi",
  "line profile", "kymograph",
  "montage", "tile scan",
  // Biochemistry assay types
  "colorimetric assay", "fluorometric",
  "luminometric", "radiometric",
  "enzymatic assay", "coupled assay",
  "continuous assay", "discontinuous",
  "endpoint assay", "kinetic assay",
  "competition assay", "inhibition assay",
  "activity assay", "binding assay",
  "displacement assay",
];

// ---------------------------------------------------------------------------
// COMBINED LIST GENERATION
// ---------------------------------------------------------------------------

// Merge all category arrays
const allTermsRaw = [
  ...MODEL_ORGANISMS,
  ...TECHNIQUES,
  ...BIOCHEM_VOCAB,
  ...REAGENTS_CHEMICALS,
  ...CELL_ANATOMY,
  ...LAB_EQUIPMENT,
  ...SAFETY_TERMS,
  ...BIOINFORMATICS,
  ...SPECIALIZED,
  ...NEUROSCIENCE,
  ...PLANT_ECOLOGY,
  ...CANCER_BIOLOGY,
  ...MICROBIOLOGY_EXTRA,
  ...PROTEOMICS_EXTRA,
  ...CHEMISTRY_EXTRA,
  ...GENOMICS_EXTRA,
  ...PROSE_VOCAB,
  ...CELL_LINE_VOCAB,
  ...SYSTEMS_BIOLOGY,
  ...MORE_REAGENTS,
  ...INSTRUMENTATION,
  ...FINAL_ADDITIONS,
];

// Normalise: lowercase, strip non-alpha chars, deduplicate, filter
function normalise(term) {
  return term
    .toLowerCase()
    // Keep only a-z and apostrophe (to allow words like "t-cell")
    // but strip hyphens by replacing with nothing (so "t-cell" -> "tcell")
    // and strip other non-alpha
    .replace(/[^a-z']/g, "")
    .trim();
}

// Some entries are multi-word phrases or contain hyphens
// We split on whitespace to pull individual words, then normalise each
function tokenise(entry) {
  // First split on whitespace
  const bySpace = entry.split(/\s+/);
  const out = [];
  for (const part of bySpace) {
    // For hyphenated terms: add both the joined form and individual parts
    if (part.includes("-")) {
      const joined = part.replace(/-/g, "");
      const parts = part.split("-");
      out.push(joined);
      for (const p of parts) out.push(p);
    } else {
      out.push(part);
    }
  }
  return out.map(normalise).filter(Boolean);
}

const seen = new Set();
const terms = [];

for (const raw of allTermsRaw) {
  for (const token of tokenise(raw)) {
    if (token.length < 3) continue;
    if (/\d/.test(token)) continue;
    if (/[^a-z']/.test(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
  }
}

terms.sort();

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
mkdirSync(join(__dirname, "../public/spellcheck"), { recursive: true });
const content = terms.join("\n") + "\n";
writeFileSync(OUTPUT_PATH, content, "utf8");

console.log(`Wrote ${terms.length} terms to ${OUTPUT_PATH}`);
console.log(`File size: ${(content.length / 1024).toFixed(1)} KB`);
