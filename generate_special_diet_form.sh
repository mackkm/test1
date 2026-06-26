#!/bin/bash

# ODSB Special Diet Form Generator
# This script generates filled-in special diet forms for Ottawa-Carleton District School Board

set -euo pipefail

# Function to display usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Generate a special diet form for ODSB (Ottawa-Carleton District School Board)

OPTIONS:
    -n, --name NAME                Student's full name (default: prompted)
    -s, --school SCHOOL            School name (default: prompted)
    -g, --grade GRADE              Grade level (default: prompted)
    -a, --allergies ALLERGIES      Allergies/dietary restrictions (default: prompted)
    -c, --conditions CONDITIONS    Medical conditions (default: prompted)
    -d, --doctor DOCTOR            Doctor name (optional)
    -p, --phone PHONE              Contact phone number (optional)
    -o, --output OUTPUT            Output file path (default: special_diet_form_[name]_[date].txt)
    --peanut                       Pre-fill with peanut allergy
    -h, --help                     Show this help message

EXAMPLES:
    # Interactive mode (prompted for all fields)
    $0

    # Pre-fill with specific information
    $0 -n "John Doe" -s "Lincoln High School" -g "10" -a "Peanut, Tree Nuts" -c "Celiac Disease"

    # Generate form with peanut allergy pre-filled
    $0 --peanut

EOF
    exit 0
}

# Default values
STUDENT_NAME=""
SCHOOL_NAME=""
GRADE=""
ALLERGIES=""
MEDICAL_CONDITIONS=""
DOCTOR_NAME=""
PHONE_NUMBER=""
OUTPUT_FILE=""
PEANUT_ALLERGY=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -n|--name)
            STUDENT_NAME="$2"
            shift 2
            ;;
        -s|--school)
            SCHOOL_NAME="$2"
            shift 2
            ;;
        -g|--grade)
            GRADE="$2"
            shift 2
            ;;
        -a|--allergies)
            ALLERGIES="$2"
            shift 2
            ;;
        -c|--conditions)
            MEDICAL_CONDITIONS="$2"
            shift 2
            ;;
        -d|--doctor)
            DOCTOR_NAME="$2"
            shift 2
            ;;
        -p|--phone)
            PHONE_NUMBER="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        --peanut)
            PEANUT_ALLERGY=true
            ALLERGIES="Peanuts"
            shift
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
if [ -z "$STUDENT_NAME" ]; then
    STUDENT_NAME=$(prompt_if_empty "Enter student's full name" "$STUDENT_NAME")
fi

if [ -z "$SCHOOL_NAME" ]; then
    SCHOOL_NAME=$(prompt_if_empty "Enter school name" "$SCHOOL_NAME")
fi

if [ -z "$GRADE" ]; then
    GRADE=$(prompt_if_empty "Enter grade level" "$GRADE")
fi

if [ -z "$ALLERGIES" ]; then
    ALLERGIES=$(prompt_if_empty "Enter allergies/dietary restrictions (comma-separated)" "$ALLERGIES")
fi

if [ -z "$MEDICAL_CONDITIONS" ]; then
    MEDICAL_CONDITIONS=$(prompt_if_empty "Enter medical conditions (optional, press Enter to skip)" "$MEDICAL_CONDITIONS")
fi

if [ -z "$DOCTOR_NAME" ]; then
    DOCTOR_NAME=$(prompt_if_empty "Enter doctor's name (optional, press Enter to skip)" "$DOCTOR_NAME")
fi

if [ -z "$PHONE_NUMBER" ]; then
    PHONE_NUMBER=$(prompt_if_empty "Enter contact phone number (optional, press Enter to skip)" "$PHONE_NUMBER")
fi

# Generate output filename if not provided
if [ -z "$OUTPUT_FILE" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    STUDENT_SAFE_NAME=$(echo "$STUDENT_NAME" | sed 's/ /_/g' | tr '[:upper:]' '[:lower:]')
    OUTPUT_FILE="special_diet_form_${STUDENT_SAFE_NAME}_${TIMESTAMP}.txt"
fi

# Get current date
FORM_DATE=$(date "+%B %d, %Y")

# Generate the form
cat > "$OUTPUT_FILE" << EOF
================================================================================
        OTTAWA-CARLETON DISTRICT SCHOOL BOARD
        SPECIAL DIET ACCOMMODATION FORM
================================================================================

Form Date: $FORM_DATE

STUDENT INFORMATION
================================================================================
Student Name:                          $STUDENT_NAME
School:                                $SCHOOL_NAME
Grade Level:                           $GRADE


DIETARY INFORMATION
================================================================================
Allergies/Dietary Restrictions:
$ALLERGIES


Medical Conditions:
${MEDICAL_CONDITIONS:-N/A}


PHYSICIAN INFORMATION
================================================================================
Physician/Doctor Name:                 ${DOCTOR_NAME:-N/A}
Contact Phone Number:                  ${PHONE_NUMBER:-N/A}


DIETARY ACCOMMODATION REQUIREMENTS
================================================================================

1. FOOD ALLERGIES & RESTRICTIONS
   The student has documented allergies/restrictions to: $ALLERGIES

   Required Actions:
   ☐ No foods containing above allergen(s) to be served at school
   ☐ Alternative meal/snack options must be provided
   ☐ Lunch must be provided from home
   ☐ Classroom celebration foods must be allergen-free


2. MEDICAL DIETARY NEEDS
   Conditions requiring special diet: ${MEDICAL_CONDITIONS:-None documented}

   Required Actions:
   ☐ Nutrition plan in place
   ☐ Food labels to be checked by school staff
   ☐ Student education on dietary restrictions
   ☐ Regular dietary compliance monitoring


3. SCHOOL ENVIRONMENT ACCOMMODATIONS
   ☐ Separate seating area if needed (away from potential allergens)
   ☐ Hand washing facilities available
   ☐ Staff supervision during meals
   ☐ Emergency protocols in place
   ☐ EpiPen on hand (if applicable)


4. PARENT/GUARDIAN RESPONSIBILITIES
   ☐ Provide safe lunch/snacks from home if necessary
   ☐ Communicate any changes to dietary needs promptly
   ☐ Update emergency contact information annually
   ☐ Provide medical documentation as requested


5. SCHOOL STAFF RESPONSIBILITIES
   ☐ Maintain awareness of student's dietary requirements
   ☐ Check all food labels before service
   ☐ Prevent cross-contamination during food preparation
   ☐ Respond appropriately to any allergic reactions
   ☐ Maintain confidentiality of medical information


EMERGENCY PROTOCOLS
================================================================================
Student exhibits symptoms of allergic reaction:
   - Difficulty breathing          ☐
   - Swelling of lips/tongue       ☐
   - Hives or skin reaction        ☐
   - Nausea/vomiting               ☐
   - Loss of consciousness         ☐

IMMEDIATE ACTIONS:
   1. Alert school office immediately
   2. Call 911 if necessary
   3. Administer EpiPen if available (if applicable)
   4. Contact parent/guardian
   5. Document incident


ACKNOWLEDGMENT
================================================================================

I/We acknowledge that I/we have reviewed the contents of this Special Diet
Accommodation Form and understand the measures being taken to protect my/our
child's health and safety.

I/We agree to:
   • Provide accurate and complete dietary information
   • Promptly communicate any changes in dietary needs
   • Work cooperatively with school staff regarding dietary accommodations
   • Update medical information as needed


Parent/Guardian Name (Print):           _____________________________

Parent/Guardian Signature:              _____________________________

Date:                                  $FORM_DATE


School Administrator:                  _____________________________

Date Received:                         _____________________________


NOTES & ADDITIONAL INFORMATION
================================================================================

This form should be completed and submitted to the school office at the
beginning of each school year or whenever there are changes to the student's
dietary needs. For questions or updates, please contact:

School Office: [School Phone Number]
Principal/Vice-Principal: [Name]


================================================================================
EOF

# Display success message
echo ""
echo "✓ Special Diet Form generated successfully!"
echo ""
echo "Form saved to: $OUTPUT_FILE"
echo ""
echo "Form Contents Preview:"
echo "---"
head -n 30 "$OUTPUT_FILE"
echo "..."
echo "---"
echo ""
echo "Next Steps:"
echo "1. Review the generated form for accuracy"
echo "2. Print the form"
echo "3. Have parent/guardian sign and date"
echo "4. Submit to school office"
echo ""
