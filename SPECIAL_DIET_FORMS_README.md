# Special Diet Form Generators

This repository contains two shell scripts for generating special diet forms:

1. **ODSB Special Diet Form** - For Ottawa-Carleton District School Board
2. **ODSP Special Diet Form** - For Ontario Disability Support Program

## Scripts Overview

### 1. ODSB Special Diet Form Generator
**File:** `generate_special_diet_form.sh`

Used for documenting dietary accommodations and allergies for students in the Ottawa-Carleton District School Board system.

#### Features
- Student information (name, school, grade)
- Allergy and dietary restriction documentation
- Medical condition tracking
- Emergency protocol guidelines
- Accommodation requirements
- Parent/guardian and school responsibilities

#### Usage

**Interactive Mode** (prompts for all information):
```bash
./generate_special_diet_form.sh
```

**Command-line Mode** (with pre-filled data):
```bash
./generate_special_diet_form.sh -n "John Doe" -s "Lincoln High School" -g "10" --peanut
```

**With Peanut Allergy Pre-filled:**
```bash
./generate_special_diet_form.sh --peanut
```

**Full Command Example:**
```bash
./generate_special_diet_form.sh \
  -n "Sarah Smith" \
  -s "Robert Frost Public School" \
  -g "5" \
  -a "Peanuts, Tree Nuts, Shellfish" \
  -c "Celiac Disease" \
  -d "Dr. Jennifer White" \
  -p "613-555-0123" \
  -o "sarah_smith_diet_form.txt"
```

#### Options
- `-n, --name NAME` - Student's full name
- `-s, --school SCHOOL` - School name
- `-g, --grade GRADE` - Grade level
- `-a, --allergies ALLERGIES` - Allergies/dietary restrictions (comma-separated)
- `-c, --conditions CONDITIONS` - Medical conditions
- `-d, --doctor DOCTOR` - Doctor name
- `-p, --phone PHONE` - Contact phone number
- `-o, --output OUTPUT` - Output file path
- `--peanut` - Pre-fill with peanut allergy
- `-h, --help` - Display help message

---

### 2. ODSP Special Diet Allowance Form Generator
**File:** `generate_odsp_special_diet_form.sh`

Used for applying for the Ontario Disability Support Program (ODSP) special diet allowance, which provides additional financial support for medically-required special diets.

#### Features
- Applicant information and ODSP case ID
- Food allergy and medical condition documentation
- Physician medical certification section
- Medical justification and declarations
- Cost estimation
- Applicant and physician signatures
- Caseworker review and approval section
- Supporting documentation checklist

#### Usage

**Interactive Mode** (prompts for all information):
```bash
./generate_odsp_special_diet_form.sh
```

**Command-line Mode** (with pre-filled data):
```bash
./generate_odsp_special_diet_form.sh -n "John Doe" -c "12345678" -d "01/15/1985" --peanut
```

**With Peanut Allergy Pre-filled:**
```bash
./generate_odsp_special_diet_form.sh --peanut
```

**Full Command Example:**
```bash
./generate_odsp_special_diet_form.sh \
  -n "John Doe" \
  -c "12345678" \
  -d "01/15/1985" \
  -a "Peanut" \
  -m "Severe Peanut Allergy" \
  -r "Medically documented allergy requiring dietary exclusion" \
  -p "Dr. Robert Johnson" \
  -o "john_doe_odsp_form.txt"
```

#### Options
- `-n, --name NAME` - Applicant's full name
- `-c, --case CASE_ID` - ODSP Case ID number
- `-d, --date-of-birth DOB` - Date of birth (MM/DD/YYYY format)
- `-a, --allergies ALLERGIES` - Food allergies (comma-separated)
- `-m, --medical MEDICAL` - Medical condition requiring diet
- `-r, --reason REASON` - Reason for special diet requirement
- `-p, --physician PHYSICIAN` - Physician name
- `-o, --output OUTPUT` - Output file path
- `--peanut` - Pre-fill with peanut allergy
- `-h, --help` - Display help message

---

## Which Form Do I Need?

### Use ODSB Form If:
- Your child attends a school in the Ottawa-Carleton District School Board
- You need to document dietary accommodations for school meals
- You want to ensure the school is aware of allergies and dietary restrictions

### Use ODSP Form If:
- You receive Ontario Disability Support Program (ODSP) benefits
- You have a medically-required special diet that increases food costs
- You need to request additional financial allowance from ODSP for special diet items

---

## Workflow Examples

### Scenario 1: School Dietary Accommodation (ODSB)
```bash
# Generate a form for a student with peanut allergy
./generate_special_diet_form.sh \
  -n "Emma Johnson" \
  -s "Riverside Public School" \
  -g "3" \
  --peanut

# Output: special_diet_form_emma_johnson_20260626_115500.txt
# Next: Print, have parent sign, submit to school office
```

### Scenario 2: ODSP Special Diet Allowance Application
```bash
# Generate ODSP form with peanut allergy for someone receiving disability support
./generate_odsp_special_diet_form.sh \
  -n "Michael Chen" \
  -c "98765432" \
  -d "03/22/1972" \
  --peanut \
  -m "Anaphylactic Peanut Allergy" \
  -r "Medical necessity - risk of severe allergic reaction"

# Output: odsp_special_diet_form_michael_chen_20260626_120000.txt
# Next: Have physician sign, gather medical docs, submit to ODSP caseworker
```

---

## Form Contents

### ODSB Form Includes:
- Student identification information
- Dietary requirements and allergies
- Medical conditions
- Accommodation checklist
- Emergency protocols
- Parent/school responsibilities
- Signature section

### ODSP Form Includes:
- Applicant and case identification
- Food allergies and medical conditions
- Physician certification section
- Medical justification
- Cost estimation
- Applicant declaration
- Caseworker approval section
- Supporting documentation checklist

---

## After Generating Your Form

### For ODSB Forms:
1. Review the completed form
2. Print the form
3. Have parent/guardian review and sign
4. Submit to school office
5. Keep a copy for your records

### For ODSP Forms:
1. Review the completed form
2. Have your physician complete the medical certification section
3. Gather supporting medical documentation (test results, diagnosis letter, etc.)
4. Sign the applicant declaration
5. Submit to your ODSP caseworker or local ODSP office
6. Keep copies for your records

---

## Tips for Completing Forms

### General Tips:
- Be as specific as possible when listing allergies
- Include multiple allergens if applicable
- Provide accurate medical information
- Keep receipts and documentation
- Follow up with appropriate authorities

### For Physicians:
- Complete the medical certification accurately
- Provide a clear diagnosis
- Specify dietary requirements clearly
- Include estimated additional food costs (for ODSP)
- Sign and date the form

### For ODSP:
- Include detailed receipts for special diet purchases
- Update ODSP when medical conditions change
- Annual review may be required
- Keep detailed records of special diet expenses

---

## Support & Contact

### ODSB (School Board)
- Contact your school office
- School website often has form submission instructions

### ODSP
- **Toll-free:** 1-800-668-9876
- **TTY (Deaf/Hard of Hearing):** 1-800-268-7095
- **Website:** www.ontario.ca/odsp
- Contact your local ODSP office or caseworker

---

## Troubleshooting

### Script Won't Run
```bash
# Make scripts executable
chmod +x generate_special_diet_form.sh
chmod +x generate_odsp_special_diet_form.sh
```

### Form Not Generated
- Check that you have write permissions in the output directory
- Ensure all required fields have been completed
- Verify the script syntax with `bash -n script_name.sh`

### Need to Edit Generated Form
- Generated forms are plain text files
- Edit with any text editor (nano, vim, gedit, etc.)
- Or regenerate with different information

---

## Version History
- **v1.0** (2026-06-26): Initial release with ODSB and ODSP form generators

---

## Notes
- Forms are generated as plain text files for maximum compatibility
- All dates are automatically filled with current date
- Forms can be edited after generation if needed
- Always keep copies of submitted forms
- Update forms if medical conditions or allergies change
