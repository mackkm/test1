#!/bin/bash

# ODSP Special Diet Allowance Form Generator
# This script generates filled-in special diet forms for Ontario Disability Support Program

set -euo pipefail

# Function to display usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Generate a special diet allowance form for ODSP (Ontario Disability Support Program)

OPTIONS:
    -n, --name NAME                Applicant's full name (default: prompted)
    -c, --case CASE_ID             ODSP Case ID number (default: prompted)
    -d, --date-of-birth DOB        Date of birth MM/DD/YYYY (default: prompted)
    -a, --allergies ALLERGIES      Food allergies (default: prompted)
    -m, --medical MEDICAL          Medical condition requiring diet (default: prompted)
    -r, --reason REASON            Reason for special diet (default: prompted)
    -p, --physician PHYSICIAN      Physician name (default: prompted)
    --peanut                       Pre-fill with peanut allergy
    -o, --output OUTPUT            Output file path (default: odsp_form_[name]_[date].txt)
    -h, --help                     Show this help message

EXAMPLES:
    # Interactive mode (prompted for all fields)
    $0

    # Pre-fill with specific information
    $0 -n "John Doe" -c "12345678" -d "01/15/1985" --peanut

    # Generate form with peanut allergy pre-filled
    $0 --peanut

EOF
    exit 0
}

# Default values
APPLICANT_NAME=""
CASE_ID=""
DATE_OF_BIRTH=""
ALLERGIES=""
MEDICAL_CONDITION=""
REASON_FOR_DIET=""
PHYSICIAN_NAME=""
OUTPUT_FILE=""
PEANUT_ALLERGY=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--name)
            APPLICANT_NAME="$2"
            shift 2
            ;;
        -c|--case)
            CASE_ID="$2"
            shift 2
            ;;
        -d|--date-of-birth)
            DATE_OF_BIRTH="$2"
            shift 2
            ;;
        -a|--allergies)
            ALLERGIES="$2"
            shift 2
            ;;
        -m|--medical)
            MEDICAL_CONDITION="$2"
            shift 2
            ;;
        -r|--reason)
            REASON_FOR_DIET="$2"
            shift 2
            ;;
        -p|--physician)
            PHYSICIAN_NAME="$2"
            shift 2
            ;;
        --peanut)
            PEANUT_ALLERGY=true
            ALLERGIES="Peanut"
            shift
            ;;
        -o|--output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            echo "Unknown option: $1"
            usage
            ;;
    esac
done

# Function to prompt for input if not provided
prompt_if_empty() {
    local prompt_text="$1"
    local var_value="$2"

    if [ -z "$var_value" ]; then
        read -p "$prompt_text: " var_value
    fi

    echo "$var_value"
}

# Interactive mode - prompt for missing information
if [ -z "$APPLICANT_NAME" ]; then
    APPLICANT_NAME=$(prompt_if_empty "Enter applicant's full name" "$APPLICANT_NAME")
fi

if [ -z "$CASE_ID" ]; then
    CASE_ID=$(prompt_if_empty "Enter ODSP Case ID number" "$CASE_ID")
fi

if [ -z "$DATE_OF_BIRTH" ]; then
    DATE_OF_BIRTH=$(prompt_if_empty "Enter date of birth (MM/DD/YYYY)" "$DATE_OF_BIRTH")
fi

if [ -z "$ALLERGIES" ]; then
    ALLERGIES=$(prompt_if_empty "Enter food allergies (comma-separated)" "$ALLERGIES")
fi

if [ -z "$MEDICAL_CONDITION" ]; then
    MEDICAL_CONDITION=$(prompt_if_empty "Enter medical condition requiring special diet" "$MEDICAL_CONDITION")
fi

if [ -z "$REASON_FOR_DIET" ]; then
    REASON_FOR_DIET=$(prompt_if_empty "Enter reason for special diet requirement" "$REASON_FOR_DIET")
fi

if [ -z "$PHYSICIAN_NAME" ]; then
    PHYSICIAN_NAME=$(prompt_if_empty "Enter physician name (optional, press Enter to skip)" "$PHYSICIAN_NAME")
fi

# Generate output filename if not provided
if [ -z "$OUTPUT_FILE" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    APPLICANT_SAFE_NAME=$(echo "$APPLICANT_NAME" | sed 's/ /_/g' | tr '[:upper:]' '[:lower:]')
    OUTPUT_FILE="odsp_special_diet_form_${APPLICANT_SAFE_NAME}_${TIMESTAMP}.txt"
fi

# Get current date
FORM_DATE=$(date "+%B %d, %Y")

# Generate the form
cat > "$OUTPUT_FILE" << EOF
================================================================================
        ONTARIO DISABILITY SUPPORT PROGRAM (ODSP)
        SPECIAL DIET ALLOWANCE REQUEST FORM
================================================================================

Form Completion Date: $FORM_DATE

APPLICANT INFORMATION
================================================================================
Full Name:                             $APPLICANT_NAME
ODSP Case ID Number:                   $CASE_ID
Date of Birth:                         $DATE_OF_BIRTH


SPECIAL DIET REQUIREMENT INFORMATION
================================================================================

Food Allergies:
$ALLERGIES

Medical Condition(s):
$MEDICAL_CONDITION

Reason for Special Diet:
$REASON_FOR_DIET

Estimated Additional Monthly Cost:    \$______________


PHYSICIAN MEDICAL CERTIFICATION
================================================================================
Physician Name:                        ${PHYSICIAN_NAME:-To be completed by physician}
Address:                               _________________________________
Phone:                                 _________________________________
Fax:                                   _________________________________
License Number:                        _________________________________


MEDICAL JUSTIFICATION
================================================================================

The undersigned physician certifies that this individual requires a special diet
for the following documented medical reasons:

☐ Food Allergy
☐ Food Intolerance/Sensitivity
☐ Celiac Disease
☐ Crohn's Disease / Inflammatory Bowel Disease
☐ Diabetes
☐ Kidney Disease
☐ Liver Disease
☐ Other: _________________________________________________________________


PHYSICIAN DECLARATION
================================================================================

I certify that I have examined the above-named individual and that in my
professional opinion, a special diet is medically necessary as outlined above.

This special diet is required:
☐ Indefinitely
☐ Temporarily (until date): __________________

The special diet must include the following:

Items to include:
_________________________________________________________________________
_________________________________________________________________________
_________________________________________________________________________

Items to avoid:
_________________________________________________________________________
_________________________________________________________________________
_________________________________________________________________________

Estimated additional monthly cost for special diet items: \$______________


Additional Medical Notes:
_________________________________________________________________________
_________________________________________________________________________
_________________________________________________________________________


Physician Signature:                    _____________________________

Physician Printed Name:                 _____________________________

Date:                                  _____________________________

Physician License/Registration Number:  _____________________________


APPLICANT/GUARDIAN DECLARATION
================================================================================

I declare that the information provided above is true and accurate to the best
of my knowledge and belief.

I understand that:
☐ I must provide receipts and invoices for special diet items purchased
☐ I may be required to provide additional medical documentation
☐ False or misleading information may result in loss of ODSP benefits
☐ The special diet allowance is in addition to the basic ODSP food allowance


Applicant/Guardian Name (Print):       _____________________________

Applicant/Guardian Signature:          _____________________________

Relationship to Applicant:             _____________________________

Date:                                  _____________________________

Contact Phone Number:                  _____________________________

Email Address:                         _____________________________


FOR ODSP CASEWORKER USE ONLY
================================================================================

Application Review Date:               _____________________________

Caseworker Name:                       _____________________________

Caseworker ID:                         _____________________________

Decision:
☐ APPROVED - Monthly allowance: \$______________
☐ APPROVED with modifications
☐ DENIED - Reason: ____________________________________________________
☐ REQUIRES ADDITIONAL INFORMATION


Caseworker Signature:                  _____________________________

Date:                                  _____________________________

Supervisor Review:                     _____________________________

Supervisor Signature:                  _____________________________

Date:                                  _____________________________


SUPPORTING DOCUMENTATION CHECKLIST
================================================================================

The following documents should be attached to this application:

☐ Medical assessment/diagnosis letter from physician
☐ Proof of allergy/intolerance (medical test results, if applicable)
☐ Prescription or dietary recommendation from healthcare provider
☐ Proof of special diet food purchases (receipts/invoices)
☐ Nutritionist recommendation (if available)
☐ Hospital discharge summary (if applicable)
☐ Other relevant medical documentation: ________________________________


NOTES & INSTRUCTIONS
================================================================================

1. SUBMISSION:
   - Complete all required sections above
   - Have your physician complete and sign the medical certification section
   - Gather supporting medical documentation
   - Submit to your ODSP caseworker or local ODSP office

2. SPECIAL DIET ALLOWANCE:
   - If approved, you will receive an additional monthly allowance
   - This allowance is added to your regular ODSP food benefit
   - You must keep receipts for special diet food purchases
   - The allowance may be reviewed annually or if your condition changes

3. ELIGIBLE SPECIAL DIETS:
   - Medical allergies (peanut, shellfish, etc.)
   - Medically diagnosed food intolerances
   - Celiac disease
   - Specific diseases requiring diet management (diabetes, kidney disease, etc.)
   - Conditions requiring nutritional supplements

4. WHAT COSTS MAY BE COVERED:
   - Special foods required due to medical condition
   - Specialized products (gluten-free, allergen-free, etc.)
   - Medical nutritional supplements (if prescribed)
   - Does NOT cover convenience items or lifestyle choices

5. REQUIRED DOCUMENTATION:
   - Valid medical diagnosis from licensed physician
   - Written medical justification
   - Proof of additional costs beyond regular food budget
   - Supporting medical test results when applicable


CONTACT INFORMATION
================================================================================

For more information about ODSP Special Diet Allowance:

ServiceOntario Contact Centre:        1-800-668-9876
TTY for Deaf and Hard of Hearing:     1-800-268-7095
Website:                              www.ontario.ca/odsp

Your Local ODSP Office:
_________________________________________________________________________


DECLARATION OF ACCURACY
================================================================================

I certify that the information provided in this form is true, accurate, and
complete. I understand that providing false information may result in:
- Denial of the special diet allowance
- Recovery of overpaid benefits
- Termination of ODSP benefits
- Possible prosecution under the law


Applicant/Guardian Signature:          _____________________________

Date:                                  $FORM_DATE


================================================================================
EOF

# Display success message
echo ""
echo "✓ ODSP Special Diet Allowance Form generated successfully!"
echo ""
echo "Form saved to: $OUTPUT_FILE"
echo ""
echo "Form Contents Preview:"
echo "---"
head -n 40 "$OUTPUT_FILE"
echo "..."
echo "---"
echo ""
echo "Next Steps:"
echo "1. Review the generated form for accuracy"
echo "2. Have your physician complete the medical certification section"
echo "3. Gather supporting medical documentation"
echo "4. Submit to your ODSP caseworker"
echo ""
